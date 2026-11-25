import { describe, expect, it } from 'vitest';

import { copyBack } from '../../src/fix/copy-back.js';
import type { VirtualizeOptions } from '../../src/virtual/types.js';
import { virtualizeForFix } from '../../src/virtual/virtualize.js';

function template(...lines: string[]): string {
  return ['<template>', ...lines, '</template>', ''].join('\n');
}

function fixWith(
  source: string,
  edits: [from: string, to: string][],
  options?: VirtualizeOptions,
) {
  const { code, rewrites } = virtualizeForFix(source, options);
  if (code === null) throw new Error('no virtual file');
  let after = code;
  for (const [from, to] of edits) {
    if (!after.includes(from))
      throw new Error(`not in the virtual file: ${from}`);
    after = after.replace(from, to);
  }
  return copyBack({ source, before: code, after, rewrites });
}

const unchanged = (source: string, code: string, offset: number) => ({
  text: source,
  refused: [{ code, offset }],
});

describe('copyBack', () => {
  it('copies a changed static value', () => {
    expect(
      fixWith(template('  <p class="p-4 flex flex">x</p>'), [
        ['`p-4 flex flex`', '`flex p-4`'],
      ]),
    ).toEqual({ text: template('  <p class="flex p-4">x</p>'), refused: [] });
  });

  it('copies the changed strings of a bound value', () => {
    expect(
      fixWith(
        template(`  <p :class="['mt-2 mb-2', ok && 'px-2 py-2']">x</p>`),
        [
          ["'mt-2 mb-2'", "'my-2'"],
          ["'px-2 py-2'", "'p-2'"],
        ],
      ),
    ).toEqual({
      text: template(`  <p :class="['my-2', ok && 'p-2']">x</p>`),
      refused: [],
    });
  });

  it('copies a changed template part next to an expression', () => {
    expect(
      fixWith(
        template('  <p :class="`text-red-500 text-red-500 ${size}`">x</p>'),
        [['`text-red-500 text-red-500 ${', '`text-red-500 ${']],
      ),
    ).toEqual({
      text: template('  <p :class="`text-red-500 ${size}`">x</p>'),
      refused: [],
    });
  });

  it('copies the values of an attribute from the settings', () => {
    expect(
      fixWith(
        template(`  <UCard :ui="{ root: 'p-2 p-2' }" />`),
        [["'p-2 p-2'", "'p-2'"]],
        { attributes: ['ui'] },
      ),
    ).toEqual({
      text: template(`  <UCard :ui="{ root: 'p-2' }" />`),
      refused: [],
    });
  });

  it('applies replacements from the end, so a shorter value moves none of the others', () => {
    expect(
      fixWith(
        template(
          '  <p class="flex flex p-2">x</p>',
          '  <i class="m-2 m-2">y</i>',
        ),
        [
          ['`flex flex p-2`', '`flex p-2`'],
          ['`m-2 m-2`', '`m-2`'],
        ],
      ),
    ).toEqual({
      text: template('  <p class="flex p-2">x</p>', '  <i class="m-2">y</i>'),
      refused: [],
    });
  });

  it('copies a value after non-ASCII text on the same line', () => {
    expect(
      fixWith(
        template('  <p title="caf\u{e9} \u{1F600}" class="p-2 p-2">x</p>'),
        [['`p-2 p-2`', '`p-2`']],
      ),
    ).toEqual({
      text: template('  <p title="caf\u{e9} \u{1F600}" class="p-2">x</p>'),
      refused: [],
    });
  });

  it('leaves a skipped attribute as it is', () => {
    expect(
      fixWith(template('  <p class="p-2 &amp; p-2" :class="`m-2 m-2`">x</p>'), [
        ['`m-2 m-2`', '`m-2`'],
      ]),
    ).toEqual({
      text: template('  <p class="p-2 &amp; p-2" :class="`m-2`">x</p>'),
      refused: [],
    });
  });

  it('ignores the disable comments between values', () => {
    const comment =
      '  <!-- oxlint-disable-next-line tailwindcss/no-unknown-classes -->';
    expect(
      fixWith(template(comment, '  <p class="p-2 p-2">x</p>'), [
        ['`p-2 p-2`', '`p-2`'],
      ]),
    ).toEqual({
      text: template(comment, '  <p class="p-2">x</p>'),
      refused: [],
    });
  });

  it('returns the source when the virtual file did not change', () => {
    const source = template('  <p class="p-2 p-2">x</p>');
    expect(fixWith(source, [])).toEqual({ text: source, refused: [] });
  });

  it('writes CRLF back in a changed multi-line value', () => {
    const source =
      '<template>\r\n  <p class="mt-2\r\n      mb-2 mt-2">x</p>\r\n</template>\r\n';
    expect(
      fixWith(source, [['`mt-2 \n      mb-2 mt-2`', '`mt-2 \n      mb-2`']]),
    ).toEqual({
      text: '<template>\r\n  <p class="mt-2\r\n      mb-2">x</p>\r\n</template>\r\n',
      refused: [],
    });
  });

  it('writes CRLF back when a fix dropped the space before the line break', () => {
    const source =
      '<template>\r\n  <p class="mt-2\r\n      mb-2 mt-2">x</p>\r\n</template>\r\n';
    expect(
      fixWith(source, [['`mt-2 \n      mb-2 mt-2`', '`mt-2\n      mb-2`']])
        .text,
    ).toBe(
      '<template>\r\n  <p class="mt-2\r\n      mb-2">x</p>\r\n</template>\r\n',
    );
  });

  it('writes CRLF back in a changed template literal of a bound value', () => {
    const source =
      '<template>\r\n  <p :class="`mt-2\r\n    mb-2 mt-2`">x</p>\r\n</template>\r\n';
    expect(
      fixWith(source, [['`mt-2 \n    mb-2 mt-2`', '`mt-2 \n    mb-2`']]),
    ).toEqual({
      text: '<template>\r\n  <p :class="`mt-2\r\n    mb-2`">x</p>\r\n</template>\r\n',
      refused: [],
    });
  });

  it('refuses a changed value with a space before a CRLF', () => {
    const source =
      '<template>\r\n  <p class="mt-2 \r\n  mb-2 mb-2">x</p>\r\n</template>\r\n';
    expect(
      fixWith(source, [['`mt-2  \n  mb-2 mb-2`', '`mt-2  \n  mb-2`']]),
    ).toEqual(unchanged(source, 'line-break', source.indexOf('class')));
  });

  it('refuses a changed value with a tab before a CRLF', () => {
    const source =
      '<template>\r\n  <p class="mt-2\t\r\n  mb-2 mb-2">x</p>\r\n</template>\r\n';
    expect(
      fixWith(source, [['`mt-2\t \n  mb-2 mb-2`', '`mt-2\t \n  mb-2`']]),
    ).toEqual(unchanged(source, 'line-break', source.indexOf('class')));
  });

  it('copies a value next to an unchanged one with a space before a CRLF', () => {
    const source =
      '<template>\r\n  <p :class="[`mt-2 \r\n  mb-2`, `p-2 p-2`]">x</p>\r\n</template>\r\n';
    expect(fixWith(source, [['`p-2 p-2`', '`p-2`']])).toEqual({
      text: '<template>\r\n  <p :class="[`mt-2 \r\n  mb-2`, `p-2`]">x</p>\r\n</template>\r\n',
      refused: [],
    });
  });

  it('refuses every fix of a file whose fixed virtual file does not parse', () => {
    const source = template(
      '  <p class="p-2 p-2">x</p>',
      '  <i class="m-2 m-2">y</i>',
    );
    expect(
      fixWith(source, [
        ['`p-2 p-2`)', '`p-2`'],
        ['`m-2 m-2`', '`m-2`'],
      ]),
    ).toEqual(unchanged(source, 'parse-error', 0));
  });

  it('refuses every fix of a file that gained or lost a value', () => {
    const source = template('  <p class="p-2 p-2">x</p>');
    expect(fixWith(source, [['`p-2 p-2`)', '`p-2`);__(`m-2`)']])).toEqual(
      unchanged(source, 'regions-changed', 0),
    );
  });

  it('ignores the code a fixed virtual file gains outside the values', () => {
    const source = template('  <p class="p-2 p-2">x</p>');
    const { code, rewrites } = virtualizeForFix(source);
    const before = code as string;
    expect(
      copyBack({
        source,
        before,
        after: `${before.replace('`p-2 p-2`', '`p-2`')}\nlet x = 1;`,
        rewrites,
      }),
    ).toEqual({ text: template('  <p class="p-2">x</p>'), refused: [] });
  });

  it('refuses the value whose code around its strings changed, and only that one', () => {
    const source = template(
      '  <p :class="`p-2 p-2`">x</p>',
      '  <i class="m-2 m-2">y</i>',
    );
    expect(
      fixWith(source, [
        ['(`p-2 p-2`)', '([`p-2`])'],
        ['`m-2 m-2`', '`m-2`'],
      ]),
    ).toEqual({
      text: template('  <p :class="`p-2 p-2`">x</p>', '  <i class="m-2">y</i>'),
      refused: [{ code: 'skeleton-changed', offset: source.indexOf(':class') }],
    });
  });

  it('refuses every value of a region when one of them is refused', () => {
    const source = template(`  <p :class="['p-2 p-2', 'm-2']">x</p>`);
    expect(
      fixWith(source, [
        ["'p-2 p-2'", "'p-2'"],
        ["'m-2'", "'m-2 &amp;'"],
      ]),
    ).toEqual(unchanged(source, 'unsafe-value', source.indexOf(':class')));
  });

  it('refuses a value whose text no longer matches the .vue file', () => {
    const source = template('  <p class="p-2 p-2">x</p>');
    const { code, rewrites } = virtualizeForFix(source);
    const edited = template('  <p class="p-2 p-3">x</p>');
    expect(
      copyBack({
        source: edited,
        before: code as string,
        after: (code as string).replace('`p-2 p-2`', '`p-2`'),
        rewrites,
      }),
    ).toEqual(unchanged(edited, 'source-mismatch', edited.indexOf('class')));
  });

  it('refuses a value that would hold the quote of its attribute', () => {
    const double = template('  <p class="p-2">x</p>');
    expect(fixWith(double, [['`p-2`', '`content-["x"]`']])).toEqual(
      unchanged(double, 'unsafe-value', double.indexOf('class')),
    );
    const single = template("  <p class='p-2'>x</p>");
    expect(fixWith(single, [['`p-2`', '`content-["x"]`']]).text).toBe(
      template(`  <p class='content-["x"]'>x</p>`),
    );
  });

  it.each([
    ['a backslash', String.raw`'p-2\\'`],
    ['a backtick', "'p-2 `'"],
    ['${', "'p-${2}'"],
    ['a named character reference', "'p-2 &amp;'"],
    ['a numeric character reference', "'p-2 &#38;'"],
    ['a NUL character', "'b\0a'"],
    ['a BEL character', "'b\x07a'"],
    ['a DEL character', "'b\x7Fa'"],
  ])('refuses a value holding %s', (_, string) => {
    const source = template(`  <p :class="'p-2 p-2'">x</p>`);
    expect(fixWith(source, [["'p-2 p-2'", string]])).toEqual(
      unchanged(source, 'unsafe-value', source.indexOf(':class')),
    );
  });

  it('accepts an arbitrary variant with &', () => {
    expect(
      fixWith(template('  <p class="p-2 p-2">x</p>'), [
        ['`p-2 p-2`', '`[&_p]:p-2`'],
      ]).text,
    ).toBe(template('  <p class="[&_p]:p-2">x</p>'));
  });

  it('keeps a tab between classes of a quoted value', () => {
    const source = template('  <p class="p-2\tp-2 flex">x</p>');
    expect(fixWith(source, [['`p-2\tp-2 flex`', '`p-2\tflex`']])).toEqual({
      text: template('  <p class="p-2\tflex">x</p>'),
      refused: [],
    });
  });

  it('refuses whitespace in a value without quotes', () => {
    const source = template('  <p class=p-2 >x</p>');
    expect(fixWith(source, [['`p-2`', '`p-2 m-2`']])).toEqual(
      unchanged(source, 'unsafe-value', source.indexOf('class')),
    );
    expect(fixWith(source, [['`p-2`', '`m-2`']]).text).toBe(
      template('  <p class=m-2 >x</p>'),
    );
  });

  it('refuses a fix that adds a line break', () => {
    const source = template('  <p class="p-2 flex">x</p>');
    expect(fixWith(source, [['`p-2 flex`', '`p-2\nflex`']])).toEqual(
      unchanged(source, 'line-break', source.indexOf('class')),
    );
  });

  it('refuses a changed value with a lone CR, or with both CRLF and LF', () => {
    const lone = '<template><p class="flex\rp-2 p-2">x</p></template>';
    expect(fixWith(lone, [['`flex\rp-2 p-2`', '`flex\rp-2`']])).toEqual(
      unchanged(lone, 'line-break', lone.indexOf('class')),
    );
    const mixed =
      '<template>\r\n  <p class="flex\r\n  p-2\n  p-2">x</p>\r\n</template>\r\n';
    expect(
      fixWith(mixed, [['`flex \n  p-2\n  p-2`', '`flex \n  p-2`']]),
    ).toEqual(unchanged(mixed, 'line-break', mixed.indexOf('class')));
  });

  it.each([
    [
      'a one-line value',
      '<template><p class="a b">x</p></template>',
      '`a b`',
      '`a\rb`',
    ],
    [
      'a multi-line LF value',
      template('  <p class="[&_p]:p-2\n  p-1">x</p>'),
      '`[&_p]:p-2\n  p-1`',
      '`[&_p]:p-2\r\n  p-1`',
    ],
    [
      'a CRLF value',
      '<template>\r\n  <p class="a\r\nb c">x</p>\r\n</template>\r\n',
      '`a \nb c`',
      '`a \r\nb`',
    ],
  ])(
    'refuses a carriage return that a fix writes in %s',
    (_, source, from, to) => {
      expect(fixWith(source, [[from, to]])).toEqual(
        unchanged(source, 'line-break', source.indexOf('class')),
      );
    },
  );

  it('reports a refusal at its attribute in the text as written', () => {
    const result = fixWith(
      template('  <p class="flex flex p-2">x</p>', '  <i class="m-2">y</i>'),
      [
        ['`flex flex p-2`', '`flex p-2`'],
        ['`m-2`', '`m-2\nm-3`'],
      ],
    );
    expect(result.text).toBe(
      template('  <p class="flex p-2">x</p>', '  <i class="m-2">y</i>'),
    );
    expect(result.refused).toEqual([
      { code: 'line-break', offset: result.text.indexOf('class="m-2"') },
    ]);
  });

  it('refuses a value whose neighboring number changed', () => {
    const source = template(`  <p :class="{ 'p-2 p-2': n > 1 }">x</p>`);
    expect(fixWith(source, [["'p-2 p-2': n > 1", "'p-2': n > 2"]])).toEqual(
      unchanged(source, 'skeleton-changed', source.indexOf(':class')),
    );
  });

  it('refuses a value that would leave an unquoted attribute empty', () => {
    const source = template('  <p class=p-2  id=x>y</p>');
    expect(fixWith(source, [['`p-2`', '``']])).toEqual(
      unchanged(source, 'unsafe-value', source.indexOf('class')),
    );
  });

  it('accepts a quoted value that becomes empty', () => {
    expect(
      fixWith(template('  <p class="p-2">y</p>'), [['`p-2`', '``']]).text,
    ).toBe(template('  <p class="">y</p>'));
  });

  it('throws when the virtual file before the passes breaks its invariants', () => {
    const source = template('  <p class="p-2">x</p>');
    const { code } = virtualizeForFix(source);
    expect(() =>
      copyBack({ source, before: 'x(', after: 'x(', rewrites: [] }),
    ).toThrow(SyntaxError);
    expect(() =>
      copyBack({
        source,
        before: code as string,
        after: code as string,
        rewrites: [],
      }),
    ).toThrow('1 regions for 0 rewrites');
  });
});
