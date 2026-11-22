import { readdirSync } from 'node:fs';

import { parse, parseCache } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

import type { SkipCode } from '../../src/virtual/types.js';
import { virtualize } from '../../src/virtual/virtualize.js';
import {
  checked,
  fixture,
  rewritten,
  skipped,
  spanOf,
  virtualBody,
  virtualOf,
} from '../helpers/virtual.js';

function fixtureNames(folder: string): string[] {
  return readdirSync(
    new URL(`../fixtures/${folder}/`, import.meta.url),
  ).toSorted();
}

function withoutWhitespace(code: string): string {
  return code.replace(/\s+/g, '');
}

describe('virtualize: bound values', () => {
  it('rewrites :class and v-bind:class as calls', () => {
    expect(virtualBody(`<p :class="{ 'p-2': x }">`)).toBe(
      "       ;__({ 'p-2': x }) ",
    );
    expect(virtualBody(`<p v-bind:class="[a, 'p-2']">`)).toBe(
      `${' '.repeat(13)};__([a, 'p-2']) `,
    );
    expect(virtualBody('<p class="p-1" :class="x">')).toBe(
      '     ;__(`p-1`)    ;__(x) ',
    );
    const source = `<template><p :class="{ 'p-2': x }"></p><p v-bind:class="[a, 'p-2']"></p></template>`;
    expect(checked(source).rewrites).toEqual([
      {
        kind: 'bound',
        attribute: ':class',
        span: spanOf(source, `:class="{ 'p-2': x }"`),
      },
      {
        kind: 'bound',
        attribute: 'v-bind:class',
        span: spanOf(source, `v-bind:class="[a, 'p-2']"`),
      },
    ]);
  });

  it('copies every expression shape', () => {
    const source = fixture('sfc/bound-shapes.vue');
    const result = checked(source);
    expect(result.skipped).toEqual([]);
    expect(result.rewrites).toHaveLength(21);
    for (const { kind, span } of result.rewrites) {
      expect(kind).toBe('bound');
      const attribute = source.slice(span.start, span.end);
      const value = attribute.slice(attribute.indexOf('=') + 1);
      const quoted = value.startsWith('"') || value.startsWith("'");
      const expression = quoted ? value.slice(1, -1) : value;
      const start = span.end - value.length + (quoted ? 1 : 0);
      expect(result.code.slice(start - 1, start + expression.length + 1)).toBe(
        `(${expression})`,
      );
    }
    const at = (snippet: string): string =>
      virtualOf(source, result.code, snippet);
    expect(at(`:class="ok ? 'p-3' : 'm-3'">`)).toBe(
      "    ;__(ok ? 'p-3' : 'm-3') ",
    );
    expect(at(':class=bare>')).toBe('   ;__(bare)');
    expect(at(':class="ok // note\n">')).toBe('    ;__(ok // note\n) ');
    expect(at(':class="">')).toBe('    ;__() ');
  });

  it('keeps TypeScript in expressions', () => {
    const source = fixture('sfc/bound-typescript.vue');
    const plain = source.replace('<script setup lang="ts">', '<script setup>');
    expect(plain).not.toContain('lang="ts"');
    for (const variant of [source, plain]) {
      const result = checked(variant);
      expect(result.skipped).toEqual([]);
      expect(rewritten(variant, result)).toEqual([
        `:class="(props.size as string) ?? 'p-1'"`,
        `:class="{ 'p-2': true } satisfies Record<string, boolean>"`,
        ':class="props.size!"',
        ':class="<string>props.tone"',
        `:class="pick<string>('p-3')"`,
        `:class="(<T,>(value: T) => value)('p-4')"`,
      ]);
    }
  });

  it('skips expressions Vue rejects with invalid-expression', () => {
    const source = fixture('sfc/bound-invalid.vue');
    const result = checked(source);
    expect(skipped(source, result)).toEqual([
      ['invalid-expression', ':class="x // c"'],
      ['invalid-expression', ':class="a; b"'],
      ['invalid-expression', `:class="['a'"`],
      ['invalid-expression', ':class="a <!-- b -->"'],
      ['invalid-expression', ':class=foo/'],
    ]);
    expect(result.skipped[0]?.attribute).toBe(':class');
    for (const { span } of result.skipped) {
      expect(result.code.slice(span.start, span.end).trim()).toBe('');
    }
    expect(rewritten(source, result)).toEqual([
      'class="p-1"',
      'class="p-2"',
      `:class="'p-3'"`,
      `:class="'p-4'"`,
    ]);
  });

  it('skips entities in expressions with entity', () => {
    const source = fixture('sfc/entities-bound.vue');
    const result = checked(source);
    expect(skipped(source, result)).toEqual([
      ['entity', `:class="ok &amp;&amp; 'p-1'"`],
      ['entity', ':class="&quot;p-2&quot;"'],
      ['entity', `:class="'&copy-x'"`],
      ['entity', `:class="n &lt; 2 ? 'p-4' : 'm-4'"`],
    ]);
    expect(rewritten(source, result)).toEqual([
      `:class="'&copyx'"`,
      `:class="{ '[&>svg]:p-3': ok }"`,
    ]);
  });

  it('ignores dynamic arguments, other directives and v-bind objects', () => {
    const source = fixture('sfc/directive-forms.vue');
    for (const options of [{}, { attributePatterns: ['.*'] }]) {
      const result = checked(source, options);
      expect(result.rewrites).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.code.trim()).toBe('');
    }
  });

  it('closes an unquoted expression on the first free slot after it', () => {
    expect(virtualBody('<p :class=foo>')).toBe('      ;__(foo)');
    expect(virtualBody('<p :class=foo id="a">')).toBe('      ;__(foo)       ');
    expect(virtualBody('<p :class=foo\n  id="a">')).toBe(
      `      ;__(foo\n)${' '.repeat(8)}`,
    );
  });

  it('skips with no-room when an expression has no slot left', () => {
    const lineBreak = '<template><p :class=foo\nid="a"></p></template>';
    expect(checked(lineBreak).skipped).toEqual([
      {
        code: 'no-room',
        attribute: ':class',
        span: spanOf(lineBreak, ':class=foo'),
      },
    ]);
    const taken = '<template><p class="p-1" :x=a></p></template>';
    const result = checked(taken, { attributes: ['x'] });
    expect(skipped(taken, result)).toEqual([['no-room', ':x=a']]);
    expect(rewritten(taken, result)).toEqual(['class="p-1"']);
  });

  it('checks components, svg, slots and native templates', () => {
    const source = fixture('sfc/elements.vue');
    const result = checked(source, { attributes: ['ui', 'contentClass'] });
    expect(result.skipped).toEqual([]);
    expect(rewritten(source, result)).toEqual([
      'class="p-1"',
      `:class="'m-1'"`,
      'class="p-2"',
      'class="p-3"',
      `:class="'m-3'"`,
      'class="size-4"',
      'class="fill-current"',
      `:class="'stroke-1'"`,
      'class="p-4"',
      'class="p-5"',
      'class="m-5"',
      'class="p-6"',
      `:class="'m-6'"`,
      'class="p-7"',
      'class="m-7"',
      'enter-active-class="transition"',
      `:leave-to-class="'opacity-0'"`,
      'class="p-8"',
      `:active-class="'font-bold'"`,
      `:ui="ui ?? 'p-9'"`,
      `:content-class="'m-9'"`,
    ]);
  });

  it('skips template wrappers', () => {
    const source = fixture('sfc/template-wrappers.vue');
    const result = checked(source);
    expect(skipped(source, result)).toEqual([
      ['template-wrapper', 'class="p-1"'],
      ['template-wrapper', `:class="'m-1'"`],
      ['template-wrapper', `:class="'m-2'"`],
      ['template-wrapper', 'class="p-4"'],
      ['template-wrapper', ':class="item"'],
      ['template-wrapper', 'class="p-6"'],
      ['template-wrapper', `:class="'p-7'"`],
    ]);
    expect(result.skipped[1]).toEqual({
      code: 'template-wrapper',
      attribute: ':class',
      span: spanOf(source, `:class="'m-1'"`),
    });
    expect(rewritten(source, result)).toEqual([
      'class="p-2"',
      `:class="'p-3'"`,
      'class="p-5"',
      ':class="cls"',
      'class="m-6"',
      'class="m-7"',
    ]);
  });

  it('checks static classes in v-pre, ignores directives there', () => {
    const source = fixture('sfc/v-pre.vue');
    for (const options of [
      {},
      { attributes: ['ui'], attributePatterns: ['class'] },
    ]) {
      const result = checked(source, options);
      expect(result.skipped).toEqual([]);
      expect(rewritten(source, result)).toEqual([
        'class="p-1 {{ raw }}"',
        'class="p-2"',
        'class="p-3"',
        'class="p-4"',
        `:class="'p-5'"`,
      ]);
      expect(virtualOf(source, result.code, '"p-1 {{ raw }}"')).toBe(
        '`p-1 {{ raw }}`',
      );
    }
  });

  it('leaves comments, text, script and custom blocks blank', () => {
    const template = fixture('sfc/not-attributes.vue');
    const inTemplate = checked(template);
    expect(rewritten(template, inTemplate)).toEqual([
      'class="p-1"',
      'class="p-2"',
    ]);
    expect(withoutWhitespace(inTemplate.code)).toBe(';__(`p-1`);__(`p-2`)');
    const blocks = fixture('sfc/script-and-custom-blocks.vue');
    expect(withoutWhitespace(checked(blocks).code)).toBe(';__(`p-1`)');
  });

  it('reads the first template block wherever it sits', () => {
    const expected: Record<string, string> = {
      'comment-before.vue': ';__(`p-1`)',
      'empty.vue': '',
      'end-tag-in-expression.vue': ";__(`p-1`);__('p-2')",
      'first-template-only.vue': ';__(`p-1`)',
      'functional.vue': ';__(`p-1`)',
      'indented.vue': ';__(`p-1`)',
      'text-only.vue': '',
    };
    const raw = ['uppercase-tag.vue', 'vue-html-lang.vue'];
    expect(fixtureNames('sfc/template-blocks')).toEqual(
      [...Object.keys(expected), ...raw].toSorted(),
    );
    for (const [name, calls] of Object.entries(expected)) {
      const result = checked(fixture(`sfc/template-blocks/${name}`));
      expect(withoutWhitespace(result.code)).toBe(calls);
    }
    expect(
      virtualize(fixture('sfc/template-blocks/uppercase-tag.vue')),
    ).toMatchObject({ code: null, rewrites: [], skipped: [] });
    expect(
      virtualize(fixture('sfc/template-blocks/vue-html-lang.vue')),
    ).toMatchObject({
      code: null,
      rewrites: [],
      skipped: [{ code: 'template-lang', attribute: '<template>' }],
    });
  });

  it('never throws on a broken template', () => {
    const expected: Record<string, [string[], [SkipCode, string][]]> = {
      'eof-in-bound-value.vue': [['class="p-1"'], []],
      'eof-in-comment.vue': [['class="p-1"'], []],
      'eof-in-interpolation.vue': [['class="p-1"'], []],
      'eof-in-static-value.vue': [['class="p-1"'], []],
      'eof-in-tag.vue': [['class="p-1"'], []],
      'lt-in-tag.vue': [['class="p-1"', 'class="p-2"'], []],
      'missing-template-end.vue': [['class="p-1"'], []],
      'missing-values.vue': [[':class= '], [['no-room', 'class= ']]],
      'stray-end-tags.vue': [['class="p-1"', 'class="p-2"'], []],
      'unclosed-elements.vue': [['class="p-1"', `:class="'p-2'"`], []],
    };
    expect(fixtureNames('sfc/broken')).toEqual(
      [...Object.keys(expected), 'directive-without-name.vue'].toSorted(),
    );
    for (const [name, [rewrites, skips]] of Object.entries(expected)) {
      const source = fixture(`sfc/broken/${name}`);
      const result = checked(source);
      expect(rewritten(source, result)).toEqual(rewrites);
      expect(skipped(source, result)).toEqual(skips);
    }
    const stray = fixture('sfc/broken/stray-end-tags.vue');
    expect(checked(stray).code).not.toContain('after-end');
  });

  it("reports sfc-parse-error when Vue's parser throws", () => {
    const source = fixture('sfc/broken/directive-without-name.vue');
    parse('<template><p class="p-1"></p></template>', {
      filename: 'cached.vue',
    });
    expect(parseCache.size).toBeGreaterThan(0);
    expect(virtualize(source)).toEqual({
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
    expect(parseCache.size).toBe(0);
  });

  it('walks deeply nested elements without recursion', () => {
    const depth = 10_000;
    const source = `<template>${'<b class="p-1">'.repeat(depth)}${'</b>'.repeat(depth)}</template>`;
    expect(checked(source).rewrites).toHaveLength(depth);
  });

  it('notes unquoted object keys', () => {
    const source = `<template><p :class="{ active: x, 'p-2': y }"></p></template>`;
    expect(checked(source).notices).toEqual([
      { code: 'unquoted-key', key: 'active', span: spanOf(source, 'active') },
    ]);
  });

  it('notes keys of top-level objects only, on rewritten attributes', () => {
    const source = [
      '<template>',
      `<p :class="[{ flex: a }, cn({ grid: b }), [{ block: c }], { [d]: e, 'p-1': f, inline, 1: g, ...h }]"></p>`,
      `<p :class="ok ? { hidden: x } : ''"></p>`,
      '<p :class="{ entity: x &amp;&amp; y }"></p>',
      '<template v-if="z" :class="{ wrapper: z }"></template>',
      `<UiCard :ui="{ base: 'p-2' }" />`,
      '</template>',
    ].join('\n');
    const result = checked(source, { attributes: ['ui'] });
    expect(result.notices).toEqual([
      { code: 'unquoted-key', key: 'flex', span: spanOf(source, 'flex') },
      { code: 'unquoted-key', key: 'inline', span: spanOf(source, 'inline') },
      { code: 'unquoted-key', key: 'base', span: spanOf(source, 'base') },
    ]);
    expect(result.skipped.map(({ code }) => code)).toEqual([
      'entity',
      'template-wrapper',
    ]);
  });
});
