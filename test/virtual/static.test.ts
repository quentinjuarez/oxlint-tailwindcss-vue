import { parseCache } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

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

function lineStarts(text: string): number[] {
  return [...text.matchAll(/\r\n|\r|\n/g)].map(
    (match) => match.index + match[0].length,
  );
}

describe('virtualize: static values', () => {
  it('rewrites a quoted class as a template literal', () => {
    expect(virtualBody('<p class="a b">')).toBe('     ;__(`a b`)');
    const source = '<template><p class="a b"></p></template>';
    expect(checked(source).rewrites).toEqual([
      {
        kind: 'static',
        attribute: 'class',
        span: spanOf(source, 'class="a b"'),
      },
    ]);
  });

  it('keeps the quotes of a value with a backtick or ${', () => {
    expect(virtualBody('<p class="a`b">')).toBe('     ;__("a`b")');
    expect(virtualBody("<p class='a${b}'>")).toBe("     ;__('a${b}')");
  });

  it('writes every quoting style with its literal', () => {
    const source = fixture('sfc/quoting.vue');
    const result = checked(source);
    const at = (snippet: string): string =>
      virtualOf(source, result.code, snippet);
    expect(at('class="p-1 m-1">')).toBe('  ;__(`p-1 m-1`)');
    expect(at("class='p-2 m-2'>")).toBe('  ;__(`p-2 m-2`)');
    expect(at('class = "p-3">')).toBe('    ;__(`p-3`)');
    expect(at('class="">')).toBe('  ;__(``)');
    expect(at(`class="before:content-['x']">`)).toBe(
      "  ;__(`before:content-['x']`)",
    );
    expect(at(`class='after:content-["y"]'>`)).toBe(
      '  ;__(`after:content-["y"]`)',
    );
    expect(at('class="p-4`">')).toBe('  ;__("p-4`")');
    expect(at("class='p-5${x}'>")).toBe("  ;__('p-5${x}')");
    expect(rewritten(source, result)).toEqual([
      'class="p-1 m-1"',
      "class='p-2 m-2'",
      'class = "p-3"',
      'class=""',
      `class="before:content-['x']"`,
      `class='after:content-["y"]'`,
      'class="p-4`"',
      "class='p-5${x}'",
      'class=flex',
    ]);
  });

  it('skips with quote-in-unquoted-value', () => {
    const source = fixture('sfc/quoting.vue');
    const result = checked(source);
    expect(virtualOf(source, result.code, 'class=flex >')).toBe(' ;__(`flex`)');
    expect(skipped(source, result)).toEqual([
      ['invalid-escape', 'class="p-6`\n    p-7"'],
      ['no-room', 'class=grid'],
      ['quote-in-unquoted-value', "class=a'b'"],
      ['quote-in-unquoted-value', 'class=a`b'],
      ['invalid-escape', 'class=p-8${x}'],
      ['no-room', 'class=\np-9'],
      ['no-room', 'class=m-9'],
    ]);
    expect(virtualOf(source, result.code, "class=a'b'>").trim()).toBe('');
  });

  it('ignores a checked attribute without a value', () => {
    const result = checked('<template><p class>x</p></template>');
    expect(result.rewrites).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('keeps CRLF inside a multi-line value', () => {
    const source = fixture('crlf/multiline-crlf.vue');
    const result = checked(source);
    expect(virtualOf(source, result.code, '"flex\r\n      p-2"\r\n  >')).toBe(
      '`flex\r\n      p-2`\r\n)  ',
    );
    expect(result.code).toHaveLength(source.length);
    expect(lineStarts(result.code)).toEqual(lineStarts(source));
    expect(rewritten(source, result)).toEqual([
      'class="flex\r\n      p-2"',
      'class="a b"',
    ]);
  });

  it('keeps lone CR line breaks and a byte order mark', () => {
    const source = fixture('crlf/cr-and-bom.vue');
    const result = checked(source);
    expect(source.charCodeAt(0)).toBe(0xfeff);
    expect(result.code[0]).toBe(' ');
    expect(virtualOf(source, result.code, '"p-1\r    m-1"')).toBe(
      '`p-1\r    m-1`',
    );
    expect(virtualOf(source, result.code, 'class="p-2">')).toBe('  ;__(`p-2`)');
    expect(result.rewrites).toHaveLength(2);
  });

  it('copies LF line breaks inside a multi-line value', () => {
    const source = fixture('sfc/multiline-lf.vue');
    const result = checked(source);
    expect(
      virtualOf(source, result.code, '"\n      flex\n      p-2\n    "\n  >'),
    ).toBe('`\n      flex\n      p-2\n    `\n)  ');
    expect(virtualOf(source, result.code, 'class="a\n      b">')).toBe(
      '  ;__(`a\n      b`)',
    );
    expect(result.rewrites).toHaveLength(2);
  });

  it('places the call around line breaks near =', () => {
    const source = fixture('sfc/equals-layout.vue');
    const result = checked(source, { attributes: ['ui'] });
    expect(virtualOf(source, result.code, 'class\n  =\n  "p-2">')).toBe(
      '     \n;__\n (`p-2`)',
    );
    expect(virtualOf(source, result.code, 'ui\n  =\n  "p-6">')).toBe(
      '  \n;__\n (`p-6`)',
    );
    expect(result.skipped).toEqual([]);
    expect(result.rewrites).toHaveLength(6);
  });

  it('borrows the whitespace before a short name', () => {
    expect(virtualBody('<p ui="a">', { attributes: ['ui'] })).toBe(
      '  ;__(`a`)',
    );
  });

  it('keeps the closing parenthesis before the next attribute', () => {
    const source = fixture('sfc/adjacent-attrs.vue');
    const result = checked(source, { attributes: ['ui'] });
    const at = (snippet: string): string =>
      virtualOf(source, result.code, snippet);
    expect(at('class="p-1" id="a">')).toBe('  ;__(`p-1`)       ');
    expect(at('class="p-2"id="b">').trim()).toBe('');
    expect(at('id="c"class="p-3">')).toBe('        ;__(`p-3`)');
    expect(at('class="p-4" class="p-5">')).toBe('  ;__(`p-4`)  ;__(`p-5`)');
    expect(at('class="p-6"/>')).toBe('  ;__(`p-6`) ');
    expect(at('class="p-7"\n     id')).toBe('  ;__(`p-7`\n)      ');
    expect(at('class="m-1"  ui="m-2">')).toBe('  ;__(`m-1`);__(`m-2`)');
    expect(skipped(source, result)).toEqual([
      ['no-room', 'class="p-2"'],
      ['no-room', 'ui="p-9"'],
    ]);
    expect(rewritten(source, result)).toEqual([
      'class="p-1"',
      'class="p-3"',
      'class="p-4"',
      'class="p-5"',
      'class="p-6"',
      'class="p-7"',
      'class="p-8"',
      'class="m-1"',
      'ui="m-2"',
    ]);
  });

  it('skips with no-room when the call does not fit before the value', () => {
    const source = '<template><p\nx="a"></p></template>';
    const result = checked(source, { attributes: ['x'] });
    expect(result.skipped).toEqual([
      { code: 'no-room', attribute: 'x', span: spanOf(source, 'x="a"') },
    ]);
    expect(result.code.trim()).toBe('');
  });

  it('skips with entity', () => {
    const source = fixture('sfc/entities-static.vue');
    const result = checked(source);
    expect(skipped(source, result)).toEqual([
      ['entity', 'class="[&amp;>*]:p-2"'],
      ['entity', 'class="before:content-[&quot;x&quot;]"'],
      ['entity', "class='before:content-[&#39;y&#39;]'"],
      ['entity', 'class="p-1&#x20;m-1"'],
      ['entity', 'class="[&gt]:p-1"'],
      ['entity', 'class="&copy-x"'],
      ['entity', 'class="p-2&nbsp;m-2"'],
    ]);
    expect(rewritten(source, result)).toEqual([
      'class="[&>svg]:size-4 [&_p]:mt-2"',
      'class="&copyx"',
    ]);
    expect(virtualOf(source, result.code, '"[&>svg]:size-4 [&_p]:mt-2"')).toBe(
      '`[&>svg]:size-4 [&_p]:mt-2`',
    );
  });

  it('skips with invalid-escape', () => {
    const source = fixture('sfc/escapes.vue');
    const result = checked(source);
    expect(skipped(source, result)).toEqual([
      ['invalid-escape', `class="content-['\\201C']"`],
      ['invalid-escape', `class="content-['\\00']"`],
      ['invalid-escape', `class="content-['\\8']"`],
      ['invalid-escape', `class="content-['\\xZZ']"`],
      ['invalid-escape', `class="content-['\\u{110000}']"`],
      ['invalid-escape', `class="content-['\\u12']"`],
      ['invalid-escape', 'class="trailing\\"'],
      ['invalid-escape', 'class="p-4`\\_"'],
    ]);
    expect(virtualOf(source, result.code, `"content-['a\\_b']"`)).toBe(
      "`content-['a\\_b']`",
    );
    expect(rewritten(source, result)).toEqual([
      `class="content-['a\\_b']"`,
      `class="content-['\\0'] p-1"`,
      `class="content-['\\x41']"`,
      `class="content-['\\u00e9']"`,
      `class="content-['\\u{1F600}']"`,
      'class="a\\\\1"',
      'class="p-2 \\\n    p-3"',
    ]);
  });

  it('copies non-ASCII values as they are', () => {
    const source = fixture('sfc/unicode-values.vue');
    const result = checked(source);
    const at = (snippet: string): string =>
      virtualOf(source, result.code, snippet);
    expect(at('"é ü \u{1F600}"')).toBe('`é ü \u{1F600}`');
    expect(at('"p-1\u00a0m-1"')).toBe('`p-1\u00a0m-1`');
    expect(at('"\u00a0p-2\u00a0"')).toBe('`\u00a0p-2\u00a0`');
    expect(at('"p-3\u2028m-3"')).toBe('`p-3\u2028m-3`');
    expect(result.rewrites).toHaveLength(4);
    expect(result.skipped).toEqual([]);
  });

  it('keeps columns after accents and emoji', () => {
    const source = fixture('sfc/non-ascii-layout.vue');
    const { code } = checked(source);
    for (const value of ['p-1 m-1', 'p-2', 'p-3']) {
      expect(code.indexOf(`\`${value}\``)).toBe(source.indexOf(`"${value}"`));
    }
  });

  it("checks the class props of built-in components and the user's attributes", () => {
    const source = fixture('sfc/class-props.vue');
    const result = checked(source, {
      attributes: ['contentClass', 'header-class'],
    });
    expect(result.rewrites.map(({ attribute }) => attribute)).toEqual([
      'enter-active-class',
      'leaveToClass',
      'move-class',
      'active-class',
      'exactActiveClass',
      'exact-active-class',
      'content-class',
    ]);
    expect(result.skipped).toEqual([
      {
        code: 'entity',
        attribute: 'header-class',
        span: spanOf(source, 'header-class="a&amp;b"'),
      },
    ]);
    expect(virtualOf(source, result.code, '"p-2  m-2\n    rounded"')).toBe(
      '`p-2  m-2\n    rounded`',
    );
  });

  it('skips classes on template wrappers', () => {
    const source =
      '<template><template v-if="a" class="x"><b class="y"></b></template><template class="z"></template></template>';
    const result = checked(source);
    expect(result.skipped).toEqual([
      {
        code: 'template-wrapper',
        attribute: 'class',
        span: spanOf(source, 'class="x"'),
      },
    ]);
    expect(rewritten(source, result)).toEqual(['class="y"', 'class="z"']);
  });

  it('skips non-HTML and src templates', () => {
    const pug = '<template lang="pug">\np(class="a")\n</template>\n';
    expect(virtualize(pug)).toEqual({
      code: null,
      rewrites: [],
      skipped: [
        {
          code: 'template-lang',
          attribute: '<template>',
          span: spanOf(pug, '\np(class="a")\n'),
        },
      ],
      notices: [],
      styleClasses: [],
    });
    const opening = '<template src="./a.html">';
    expect(virtualize(`${opening}</template>\n`).skipped).toEqual([
      {
        code: 'template-src',
        attribute: '<template>',
        span: { start: opening.length, end: opening.length },
      },
    ]);
    for (const source of [
      '<template src="">\n<p class="a"></p>\n</template>\n',
      '<template src>\n<p class="a"></p>\n</template>\n',
    ]) {
      expect(virtualize(source)).toMatchObject({
        code: null,
        rewrites: [],
        skipped: [{ code: 'template-src', attribute: '<template>' }],
      });
    }
    expect(virtualize('<script>export default {}</script>\n')).toEqual({
      code: null,
      rewrites: [],
      skipped: [],
      notices: [],
      styleClasses: [],
    });
  });

  it('reads a template with lang="html" or an empty lang as HTML', () => {
    for (const lang of ['html', '']) {
      const source = `<template lang="${lang}"><p class="a"></p></template>`;
      expect(rewritten(source, checked(source))).toEqual(['class="a"']);
    }
  });

  it('returns a result for a template Vue cannot fully parse', () => {
    expect(checked('<template>\n<div class="a b').rewrites).toEqual([]);
    expect(checked('<template>\n<div class=flex').rewrites).toEqual([]);
    const unclosed = '<template><p class="a b">x</p>';
    expect(rewritten(unclosed, checked(unclosed))).toEqual(['class="a b"']);
  });

  it("leaves compiler-sfc's parse cache empty", () => {
    for (const source of [
      '<template><p class="a"></p></template>',
      '<template lang="pug">\np(class="a")\n</template>\n',
      '<template src="./a.html"></template>\n',
      '<script>export default {}</script>\n',
    ]) {
      virtualize(source);
      expect(parseCache.size).toBe(0);
    }
  });
});
