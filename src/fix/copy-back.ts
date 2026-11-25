import { parse } from '@babel/parser';

import type { Rewrite } from '../virtual/types.js';

export type FixRefusalCode =
  | 'parse-error'
  | 'regions-changed'
  | 'skeleton-changed'
  | 'source-mismatch'
  | 'unsafe-value'
  | 'line-break'
  | 'changed-on-disk';

export interface Refusal {
  code: Exclude<FixRefusalCode, 'changed-on-disk'>;
  /** UTF-16 index in `CopyBackResult.text`. */
  offset: number;
}

export interface CopyBackInput {
  source: string;
  before: string;
  after: string;
  rewrites: readonly Rewrite[];
}

export interface CopyBackResult {
  text: string;
  refused: Refusal[];
}

interface Token {
  label: string;
  value: string | undefined;
  start: number;
  end: number;
}

interface Region {
  tokens: Token[];
}

interface ValueSpan {
  start: number;
  end: number;
}

interface Replacement extends ValueSpan {
  text: string;
}

type Outcome = { replacements: Replacement[] } | { refused: Refusal['code'] };

const VALUE_LABELS = new Set(['string', '...`', '...${']);
const IGNORED_LABELS = new Set(['CommentBlock', 'CommentLine', 'eof']);
const CALLEES = new Set(['__', '___']);
const UNSAFE_VALUE = /[\\`]|\$\{|&[#A-Za-z]/;
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const UNSAFE_UNQUOTED = /[\t\n\f\r "'=<>]/;
const LONE_CR = /\r(?!\n)/;
const LONE_LF = /(?<!\r)\n/;
const BLANK_BEFORE_CRLF = /[\t ]\r\n/;

export function copyBack({
  source,
  before,
  after,
  rewrites,
}: CopyBackInput): CopyBackResult {
  const beforeRegions = regionsOf(tokenize(before));
  const fixable = rewrites.filter(({ kind }) => kind !== 'comment');
  if (beforeRegions.length !== fixable.length) {
    throw new Error(
      `${beforeRegions.length} regions for ${fixable.length} rewrites`,
    );
  }
  let afterTokens: Token[];
  try {
    afterTokens = tokenize(after);
  } catch {
    return { text: source, refused: [{ code: 'parse-error', offset: 0 }] };
  }
  const afterRegions = regionsOf(afterTokens);
  if (afterRegions.length !== beforeRegions.length) {
    return { text: source, refused: [{ code: 'regions-changed', offset: 0 }] };
  }

  const refused: Refusal[] = [];
  const accepted: Replacement[] = [];
  let shift = 0;
  beforeRegions.forEach((region, index) => {
    const rewrite = fixable[index] as Rewrite;
    const outcome = checkRegion(
      source,
      before,
      after,
      region,
      afterRegions[index] as Region,
      rewrite,
    );
    if ('refused' in outcome) {
      refused.push({
        code: outcome.refused,
        offset: rewrite.span.start + shift,
      });
      return;
    }
    for (const replacement of outcome.replacements) {
      accepted.push(replacement);
      shift += replacement.text.length - (replacement.end - replacement.start);
    }
  });

  let text = source;
  for (const { start, end, text: replacement } of accepted.toReversed()) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }
  return { text, refused };
}

function tokenize(code: string): Token[] {
  const { tokens } = parse(code, {
    sourceType: 'module',
    plugins: ['typescript'],
    tokens: true,
  });
  return (tokens ?? []).flatMap((token) => {
    const label =
      typeof token.type === 'object' ? token.type.label : token.type;
    if (IGNORED_LABELS.has(label)) return [];
    return [
      {
        label,
        value: VALUE_LABELS.has(label)
          ? undefined
          : code.slice(token.start, token.end),
        start: token.start,
        end: token.end,
      },
    ];
  });
}

function regionsOf(tokens: readonly Token[]): Region[] {
  const regions: Region[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const [semicolon, callee, open] = [
      tokens[index],
      tokens[index + 1],
      tokens[index + 2],
    ];
    if (
      semicolon?.label !== ';' ||
      callee?.label !== 'name' ||
      !CALLEES.has(callee.value ?? '') ||
      open?.label !== '('
    )
      continue;
    let depth = 0;
    let end = index + 2;
    for (; end < tokens.length; end++) {
      const label = (tokens[end] as Token).label;
      if (label === '(') depth++;
      else if (label === ')' && --depth === 0) break;
    }
    regions.push({ tokens: tokens.slice(index, end + 1) });
    index = end;
  }
  return regions;
}

function checkRegion(
  source: string,
  before: string,
  after: string,
  beforeRegion: Region,
  afterRegion: Region,
  rewrite: Rewrite,
): Outcome {
  if (!sameSkeleton(beforeRegion, afterRegion)) {
    return { refused: 'skeleton-changed' };
  }
  const replacements: Replacement[] = [];
  const beforeValues = valueTokens(beforeRegion);
  const afterValues = valueTokens(afterRegion);
  for (const [index, beforeToken] of beforeValues.entries()) {
    const span = contentSpan(beforeToken);
    const beforeContent = before.slice(span.start, span.end);
    const afterToken = afterValues[index] as Token;
    const afterSpan = contentSpan(afterToken);
    const afterContent = after.slice(afterSpan.start, afterSpan.end);
    if (afterContent === beforeContent) continue;
    const original = source.slice(span.start, span.end);
    const refusal = refusalOf(original, beforeContent, afterContent);
    if (refusal) return { refused: refusal };
    const text = withOriginalLineBreaks(afterContent, original);
    if (isUnsafe(text, source.slice(rewrite.span.start, rewrite.span.end))) {
      return { refused: 'unsafe-value' };
    }
    replacements.push({ ...span, text });
  }
  return { replacements };
}

function valueTokens({ tokens }: Region): Token[] {
  return tokens.filter(({ label }) => VALUE_LABELS.has(label));
}

function contentSpan({ label, start, end }: Token): ValueSpan {
  return { start: start + 1, end: label === '...${' ? end - 2 : end - 1 };
}

function sameSkeleton(a: Region, b: Region): boolean {
  return skeleton(a) === skeleton(b);
}

function skeleton({ tokens }: Region): string {
  return JSON.stringify(
    tokens.map(({ label, value }) =>
      VALUE_LABELS.has(label) ? label : [label, value],
    ),
  );
}

function refusalOf(
  original: string,
  beforeContent: string,
  afterContent: string,
): Refusal['code'] | undefined {
  if (original.replaceAll('\r\n', ' \n') !== beforeContent) {
    return 'source-mismatch';
  }
  if (
    LONE_CR.test(original) ||
    (original.includes('\r\n') && LONE_LF.test(original)) ||
    BLANK_BEFORE_CRLF.test(original) ||
    afterContent.includes('\r') ||
    countLineFeeds(afterContent) > countLineFeeds(beforeContent)
  ) {
    return 'line-break';
  }
  return undefined;
}

function countLineFeeds(text: string): number {
  return text.split('\n').length - 1;
}

function withOriginalLineBreaks(content: string, original: string): string {
  return original.includes('\r\n')
    ? content.replaceAll(/ ?\n/g, '\r\n')
    : content;
}

function isUnsafe(text: string, attribute: string): boolean {
  if (UNSAFE_VALUE.test(text) || CONTROL_CHARACTER.test(text)) return true;
  const quote = /^[^=]*=[\t\n\f\r ]*(["'])?/.exec(attribute)?.[1];
  return quote === undefined
    ? text === '' || UNSAFE_UNQUOTED.test(text)
    : text.includes(quote);
}
