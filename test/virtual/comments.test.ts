import type { SFCParseOptions } from '@vue/compiler-sfc';
import { describe, expect, it, vi } from 'vitest';

import { assertContract } from '../helpers/contract.js';
import {
  checked,
  fixture,
  rewritten,
  spanOf,
  virtualOf,
} from '../helpers/virtual.js';

const NEXT_LINE =
  '<!-- oxlint-disable-next-line tailwindcss/no-unknown-classes -->';
const MULTI_LINE =
  '<!--\n    eslint-disable tailwindcss/no-unknown-classes\n  -->';

describe('virtualize: disable comments', () => {
  it('turns oxlint and eslint directives into block comments of the same length', () => {
    const source = fixture('sfc/disable-comments.vue');
    const result = checked(source);
    const at = (snippet: string): string =>
      virtualOf(source, result.code, snippet);
    expect(at(NEXT_LINE)).toBe(
      '/*   oxlint-disable-next-line tailwindcss/no-unknown-classes  */',
    );
    expect(at('<!--oxlint-disable-line-->')).toBe('/*  oxlint-disable-line */');
    expect(at(MULTI_LINE)).toBe(
      '/*  \n    eslint-disable tailwindcss/no-unknown-classes\n   */',
    );
    expect(at('<!-- eslint-enable -->')).toBe('/*   eslint-enable  */');
    expect(at('<!-- oxlint-enable -->')).toBe('/*   oxlint-enable  */');
    expect(at('<!-- eslint-disable-line -->')).toBe(
      '/*   eslint-disable-line  */',
    );
    expect(result.rewrites[0]).toEqual({
      kind: 'comment',
      attribute: 'comment',
      span: spanOf(source, NEXT_LINE),
    });
    expect(rewritten(source, result)).toEqual([
      NEXT_LINE,
      'class="p-1"',
      '<!--oxlint-disable-line-->',
      MULTI_LINE,
      'class="p-2"',
      '<!-- eslint-enable -->',
      '<!-- oxlint-enable -->',
      '<!-- eslint-disable-line -->',
    ]);
    expect(result.skipped).toEqual([]);

    const crlf =
      '<template>\r\n<!--\r\n  oxlint-disable\r\n-->\r\n<p class="p-3"></p>\r\n</template>\r\n';
    expect(
      virtualOf(crlf, checked(crlf).code, '<!--\r\n  oxlint-disable\r\n-->'),
    ).toBe('/*  \r\n  oxlint-disable\r\n */');
  });

  it('leaves other comments and comments containing */ blank', () => {
    const source = fixture('sfc/disable-comments.vue');
    const result = checked(source);
    for (const snippet of [
      '<!-- note: oxlint-disable must start the comment -->',
      '<!-- eslint-disable-next-line */ -->',
      '<!-- <p class="in-comment"></p> -->',
      '<textarea><!-- oxlint-disable --></textarea>',
    ]) {
      expect(virtualOf(source, result.code, snippet).trim()).toBe('');
    }
    const unclosed = '<template>\n<p class="p-1"></p>\n<!-- oxlint-disable';
    expect(rewritten(unclosed, checked(unclosed))).toEqual(['class="p-1"']);
    const outsideTemplate =
      '<!-- oxlint-disable -->\n<template><p class="p-1"></p></template>\n';
    expect(rewritten(outsideTemplate, checked(outsideTemplate))).toEqual([
      'class="p-1"',
    ]);
  });

  it('keeps disable comments when compiler-core drops comments by default', async () => {
    vi.resetModules();
    vi.doMock('@vue/compiler-sfc', async (importOriginal) => {
      const sfc = await importOriginal<typeof import('@vue/compiler-sfc')>();
      return {
        ...sfc,
        parse: (source: string, options: SFCParseOptions = {}) =>
          sfc.parse(source, {
            ...options,
            templateParseOptions: {
              comments: false,
              ...options.templateParseOptions,
            },
          }),
      };
    });
    try {
      const { virtualize } = await import('../../src/virtual/virtualize.js');
      const source = '<template><!-- oxlint-disable --></template>';
      const { code } = virtualize(source);
      expect(code).toBe(
        `${' '.repeat(10)}/*   oxlint-disable  */${' '.repeat(11)}`,
      );
      assertContract(source, code as string);
    } finally {
      vi.doUnmock('@vue/compiler-sfc');
      vi.resetModules();
    }
  });
});
