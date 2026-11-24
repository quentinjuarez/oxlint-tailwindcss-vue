import type {
  NodeTypes,
  SourceLocation,
  TemplateChildNode,
} from '@vue/compiler-core';
import { parse, parseCache } from '@vue/compiler-sfc';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type {
  Rewrite,
  SourceSpan,
  VirtualizeResult,
} from '../../src/virtual/types.js';
import { virtualize } from '../../src/virtual/virtualize.js';
import { assertContract } from '../helpers/contract.js';

const SEED = 20_261_122;
const RUNS = 500;
const OPTIONS = { attributes: ['ui'] };
const CANARY = '<template><p :class="x"></p></template>';

const ELEMENT = 1 as NodeTypes.ELEMENT;
const COMMENT = 3 as NodeTypes.COMMENT;
const ATTRIBUTE = 6 as NodeTypes.ATTRIBUTE;
const SIMPLE_EXPRESSION = 4 as NodeTypes.SIMPLE_EXPRESSION;
const DIRECTIVE_SHAPED = /^(?:[#.:@]|v-)/;
const DIRECTIVE_COMMENT = /^\s*(?:oxlint|eslint)-(?:disable|enable)/;
const HTML_WHITESPACE = /[\t\n\f\r ]/;
const TAG_RUN = /[\t\n\f\r /]/;
const BLANK = /^[\n\r ]*$/;
const CLASS_BINDING = /^(?::|v-bind:)class$/;

const unit = fc.constantFrom(
  'p-1',
  'm-2',
  'flex',
  'hover:bg-red-500',
  ' ',
  '-',
  ':',
  '[',
  ']',
  '/',
  '_',
  '.',
  '!',
  '#',
  '%',
  '(',
  ')',
  '{',
  '}',
  ',',
  '?',
  '&',
  'amp;',
  '&amp;',
  '&quot;',
  '\\',
  '`',
  '${',
  '"',
  "'",
  '\r',
  '\n',
  '\r\n',
  '\t',
  '\u00e9',
  '\u00a0',
  '\u2028',
  '\u{1F600}',
);
const value = fc.array(unit, { maxLength: 8 }).map((units) => units.join(''));
const classes = fc
  .array(
    fc.constantFrom(
      'p-1',
      'flex',
      'hover:bg-red-500',
      '[&>svg]:size-4',
      'w-1/2',
      'bg-[#fff]',
      "content-['x']",
    ),
    { maxLength: 4 },
  )
  .map((names) => names.join(' '));
const expression = fc.oneof(
  value,
  fc.constantFrom(
    "'p-1'",
    "ok ? 'p-1' : 'm-1'",
    "{ active: ok, 'p-2': x }",
    '[a, { flex: b }]',
    "(size as string) ?? 'p-1'",
    "static ? 'p-1' : 'm-1'",
    'yield',
    "010 && 'p-3'",
    "'\\1'",
    'ok\u{1F600}',
    'a\u00a0b',
    'a\u2028b',
    'if',
    'class',
    'a) => (b',
    'a <!-- `\n',
    '{ gone: yield }',
  ),
);
const quote = fc.constantFrom('"', "'", '');
const aroundEquals = fc.oneof(
  { weight: 6, arbitrary: fc.constant('') },
  fc.constantFrom(' ', '\t', '\n', '\r\n', '\r', '\n  '),
);
const separator = fc.oneof(
  { weight: 4, arbitrary: fc.constant(' ') },
  fc.constantFrom('  ', '\t', '\n  ', '\r\n', ''),
);

function valued(
  names: fc.Arbitrary<string>,
  values: fc.Arbitrary<string>,
): fc.Arbitrary<string> {
  return fc
    .tuple(names, aroundEquals, aroundEquals, quote, values)
    .map(
      ([name, before, after, mark, text]) =>
        `${name}${before}=${after}${mark}${text}${mark}`,
    );
}

const attribute = fc.oneof(
  {
    weight: 3,
    arbitrary: valued(
      fc.constantFrom(
        'class',
        'ui',
        'enter-active-class',
        'leaveToClass',
        'active-class',
        'id',
      ),
      fc.oneof(classes, value),
    ),
  },
  {
    weight: 3,
    arbitrary: valued(
      fc.constantFrom(
        ':class',
        'v-bind:class',
        ':ui',
        ':enter-active-class',
        ':active-class',
        ':id',
      ),
      expression,
    ),
  },
  fc.constantFrom(
    'class',
    ':class',
    'v-if="ok"',
    'v-for="item in items"',
    'v-pre',
    '#default',
    'disabled',
  ),
);
const tagName = fc.constantFrom(
  'div',
  'p',
  'svg',
  'UiCard',
  'Transition',
  'transition',
  'RouterLink',
  'router-link',
  'template',
  'textarea',
  'pre',
);
const text = fc.constantFrom(
  'text',
  ' ',
  '\n  ',
  '\r\n',
  '{{ a }}',
  '\u00e9',
  '\u{1F600}',
  '&amp;',
);
const comment = fc
  .tuple(
    fc.constantFrom('', ' ', '\n  ', '\r\n'),
    fc.constantFrom(
      'oxlint-disable-next-line tailwindcss/no-unknown-classes',
      'oxlint-enable',
      'eslint-disable',
      'eslint-enable x',
      'note',
      'eslint-disable */ y',
      '<p class="x">',
    ),
    fc.constantFrom('', ' ', '\n'),
  )
  .map(([before, body, after]) => `<!--${before}${body}${after}-->`);

function element(depth: number): fc.Arbitrary<string> {
  return fc
    .tuple(
      tagName,
      fc.array(fc.tuple(separator, attribute), { minLength: 1, maxLength: 4 }),
      fc.constantFrom('>', ' >', '\n>', '/>'),
      depth > 0 ? nodes(depth - 1) : fc.constant(''),
    )
    .map(([name, attributes, end, children]) => {
      const opening = attributes
        .map(
          ([space, written], index) =>
            `${index === 0 && space === '' ? ' ' : space}${written}`,
        )
        .join('');
      return end === '/>'
        ? `<${name}${opening}/>`
        : `<${name}${opening}${end}${children}</${name}>`;
    });
}

function nodes(depth: number): fc.Arbitrary<string> {
  return fc
    .array(fc.oneof({ weight: 4, arbitrary: element(depth) }, text, comment), {
      minLength: 1,
      maxLength: 3,
    })
    .map((parts) => parts.join(''));
}

const sfc = fc
  .tuple(
    nodes(2),
    fc.constantFrom('</template>\n', '</template>', '\n<!-- oxlint-disable'),
  )
  .map(([body, end]) => `<template>${body}${end}`);

interface Expected {
  kind: Rewrite['kind'];
  span: SourceSpan;
  inner: SourceSpan;
}

function isCheckedName(tag: string, name: string): boolean {
  return (
    name === 'class' ||
    name === 'ui' ||
    (['Transition', 'transition'].includes(tag) &&
      ['enter-active-class', 'leaveToClass'].includes(name)) ||
    (['RouterLink', 'router-link'].includes(tag) && name === 'active-class')
  );
}

function expectedRecords(source: string): Expected[] {
  const { template } = parse(source, {
    filename: 'component.vue',
    sourceMap: false,
    templateParseOptions: { comments: true },
  }).descriptor;
  parseCache.clear();
  const expected: Expected[] = [];
  const pending: TemplateChildNode[] = [...(template?.ast?.children ?? [])];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (node.type === COMMENT) {
      const { start, end } = offsets(node.loc);
      if (
        DIRECTIVE_COMMENT.test(node.content) &&
        !node.content.includes('*/') &&
        end <= source.length
      ) {
        expected.push({
          kind: 'comment',
          span: { start, end },
          inner: { start: start + 4, end: end - 3 },
        });
      }
    }
    if (node.type !== ELEMENT) continue;
    for (const prop of node.props) {
      if (prop.type === ATTRIBUTE) {
        if (
          !prop.value ||
          DIRECTIVE_SHAPED.test(prop.name) ||
          !isCheckedName(node.tag, prop.name)
        )
          continue;
        const { start, end } = offsets(prop.value.loc);
        const quoted = source[start] === '"' || source[start] === "'";
        expected.push({
          kind: 'static',
          span: offsets(prop.loc),
          inner: quoted ? { start: start + 1, end: end - 1 } : { start, end },
        });
      } else if (
        prop.name === 'bind' &&
        prop.arg?.type === SIMPLE_EXPRESSION &&
        prop.arg.isStatic &&
        prop.exp &&
        isCheckedName(node.tag, prop.arg.content)
      ) {
        expected.push({
          kind: 'bound',
          span: offsets(prop.loc),
          inner: offsets(prop.exp.loc),
        });
      }
    }
    pending.push(...node.children);
  }
  return expected;
}

function offsets(loc: SourceLocation): SourceSpan {
  return { start: loc.start.offset, end: loc.end.offset };
}

function sortedSpans(records: readonly { span: SourceSpan }[]): SourceSpan[] {
  return records
    .map(({ span }) => span)
    .toSorted((a, b) => a.start - b.start || a.end - b.end);
}

function isWithin(inner: SourceSpan, outer: SourceSpan): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function wrapperZone(source: string, { kind, span }: Rewrite): SourceSpan {
  if (kind === 'comment') return span;
  let start = span.start;
  while (HTML_WHITESPACE.test(source.charAt(start - 1))) start--;
  let end = span.end;
  while (TAG_RUN.test(source.charAt(end))) end++;
  return { start, end: source[end] === '>' ? end + 1 : end };
}

function expectCutInsideVPreTag(
  source: string,
  result: VirtualizeResult,
): void {
  expect(source).toContain('v-pre');
  expect(result).toEqual({
    code: null,
    rewrites: [],
    skipped: [
      {
        code: 'sfc-parse-error',
        attribute: '<template>',
        span: { start: 0, end: source.length },
      },
    ],
    notices: [],
    styleClasses: [],
  });
}

function checkTemplate(source: string): void {
  const result = virtualize(source, OPTIONS);
  expect(
    virtualize(CANARY).rewrites.map(({ kind }) => kind),
    'a later file lost its bound attributes',
  ).toEqual(['bound']);
  const { code } = result;
  if (code === null) {
    expectCutInsideVPreTag(source, result);
    return;
  }
  assertContract(source, code);
  const expected = expectedRecords(source);
  expect(sortedSpans([...result.rewrites, ...result.skipped])).toEqual(
    sortedSpans(expected),
  );
  for (const rewrite of result.rewrites) {
    const match = expected.find(
      ({ span }) =>
        span.start === rewrite.span.start && span.end === rewrite.span.end,
    ) as Expected;
    expect(rewrite.kind).toBe(match.kind);
    expect(code.slice(match.inner.start, match.inner.end)).toBe(
      source.slice(match.inner.start, match.inner.end),
    );
  }
  for (const { span } of result.skipped) {
    expect(code.slice(span.start, span.end)).toMatch(BLANK);
  }
  const zones = result.rewrites.map((rewrite) => wrapperZone(source, rewrite));
  for (let index = 0; index < source.length; index++) {
    if (code[index] === ' ' || code[index] === source[index]) continue;
    expect(
      zones.some(({ start, end }) => index >= start && index < end),
      `${JSON.stringify(code[index])} at ${index} lies outside every rewrite zone`,
    ).toBe(true);
  }
  for (const notice of result.notices) {
    expect(source.slice(notice.span.start, notice.span.end)).toBe(notice.key);
    expect(
      result.rewrites.some(
        (rewrite) =>
          CLASS_BINDING.test(rewrite.attribute) &&
          isWithin(notice.span, rewrite.span),
      ),
    ).toBe(true);
  }
}

describe('virtualize: contract property', () => {
  it('keeps the contract on generated templates', { timeout: 30_000 }, () => {
    fc.assert(fc.property(sfc, checkTemplate), {
      seed: SEED,
      numRuns: RUNS,
    });
  });
});
