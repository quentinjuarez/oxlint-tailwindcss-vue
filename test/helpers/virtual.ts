import { readFileSync } from 'node:fs';

import type {
  SkipCode,
  SourceSpan,
  VirtualizeOptions,
  VirtualizeResult,
} from '../../src/virtual/types.js';
import { virtualize } from '../../src/virtual/virtualize.js';
import { assertContract } from './contract.js';

const TEMPLATE_OPEN = '<template>';

export function fixture(path: string): string {
  return readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8');
}

export function checked(
  source: string,
  options?: VirtualizeOptions,
): VirtualizeResult & { code: string } {
  const result = virtualize(source, options);
  const { code } = result;
  if (code === null) throw new Error('no virtual file');
  assertContract(source, code);
  return { ...result, code };
}

export function virtualBody(body: string, options?: VirtualizeOptions): string {
  const { code } = checked(`${TEMPLATE_OPEN}${body}</template>`, options);
  return code.slice(TEMPLATE_OPEN.length, TEMPLATE_OPEN.length + body.length);
}

export function spanOf(source: string, snippet: string): SourceSpan {
  const start = source.indexOf(snippet);
  if (start === -1 || source.includes(snippet, start + 1)) {
    throw new Error(`snippet is missing or not unique: ${snippet}`);
  }
  return { start, end: start + snippet.length };
}

export function virtualOf(
  source: string,
  code: string,
  snippet: string,
): string {
  const { start, end } = spanOf(source, snippet);
  return code.slice(start, end);
}

export function rewritten(source: string, result: VirtualizeResult): string[] {
  return result.rewrites.map(({ span }) => source.slice(span.start, span.end));
}

export function skipped(
  source: string,
  result: VirtualizeResult,
): [SkipCode, string][] {
  return result.skipped.map(({ code, span }) => [
    code,
    source.slice(span.start, span.end),
  ]);
}
