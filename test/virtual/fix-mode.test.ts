import { describe, expect, it } from 'vitest';

import { virtualize, virtualizeForFix } from '../../src/virtual/virtualize.js';
import { assertContract } from '../helpers/contract.js';

const crlf =
  '<template>\r\n  <p class="flex\r\n    p-2">x</p>\r\n</template>\r\n';

function sliceOf(source: string, code: string | null, snippet: string) {
  const start = source.indexOf(snippet);
  return code?.slice(start, start + snippet.length);
}

describe('virtualizeForFix', () => {
  it('writes the CRLF of a static value as a space and a LF, and no other', () => {
    const { code } = virtualizeForFix(crlf);
    expect(sliceOf(crlf, code, 'flex\r\n    p-2')).toBe('flex \n    p-2');
    expect(code?.split('\r\n')).toHaveLength(4);
    assertContract(crlf, code as string, { fix: true });
    expect(() => assertContract(crlf, code as string)).toThrow(
      'line break mismatch',
    );
  });

  it('writes the CRLF of a bound expression and of its template literals the same way', () => {
    const source =
      '<template>\r\n  <p :class="[\r\n    `flex\r\n    p-2`,\r\n  ]">x</p>\r\n</template>\r\n';
    const { code } = virtualizeForFix(source);
    expect(sliceOf(source, code, '[\r\n    `flex\r\n    p-2`,\r\n  ]')).toBe(
      '[ \n    `flex \n    p-2`, \n  ]',
    );
    assertContract(source, code as string, { fix: true });
  });

  it('keeps a lone CR as the report mode writes it', () => {
    const source = '<template><p class="flex\rp-2">x</p></template>';
    expect(virtualizeForFix(source).code).toBe(virtualize(source).code);
  });

  it('gives the rewrites and skips of the report mode', () => {
    expect({ ...virtualizeForFix(crlf), code: null }).toEqual({
      ...virtualize(crlf),
      code: null,
    });
  });

  it('skips a bound string with a line continuation before a CRLF, in fix mode only', () => {
    const source = `<template>\r\n  <p :class="'p-2 \\\r\n  m-2'">x</p>\r\n</template>\r\n`;
    const span = { start: source.indexOf(':class'), end: source.indexOf('>x') };
    expect(virtualize(source).rewrites).toEqual([
      { kind: 'bound', attribute: ':class', span },
    ]);
    const { rewrites, skipped } = virtualizeForFix(source);
    expect(rewrites).toEqual([]);
    expect(skipped).toEqual([
      { code: 'parse-safety-net', attribute: ':class', span },
    ]);
  });

  it('leaves the report mode as the contract says', () => {
    const { code } = virtualize(crlf);
    expect(sliceOf(crlf, code, 'flex\r\n    p-2')).toBe('flex\r\n    p-2');
    assertContract(crlf, code as string);
  });
});
