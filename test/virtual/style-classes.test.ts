import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { collectStyleClasses } from '../../src/virtual/style-classes.js';
import { virtualize } from '../../src/virtual/virtualize.js';
import { checked } from '../helpers/virtual.js';

const css = (content: string): string[] =>
  collectStyleClasses(content, undefined, false);

function fixture(name: string): string {
  return readFileSync(
    new URL(`../fixtures/sfc/${name}`, import.meta.url),
    'utf8',
  );
}

describe('collectStyleClasses', () => {
  it('ignores comments, strings, url(), @import and attribute selectors', () => {
    expect(
      css(`
        /* .commented { } */
        @import url("theme.css");
        @import "other.css";
        .a { background: url(x.png); content: ".in-string"; src: url('f.woff2'); }
        a[href$=".pdf"] { color: red; }
        a[href$=.pdf] { color: red; }
        .b { margin: 0.5rem; }
      `),
    ).toEqual(['a', 'b']);
  });

  it('decodes CSS escapes', () => {
    expect(css(String.raw`.md\:flex { } .w-1\/2 { } .\31 0col { }`)).toEqual([
      '10col',
      'md:flex',
      'w-1/2',
    ]);
  });

  it('splits selectors on top-level commas and reads pseudo-class arguments', () => {
    expect(css(':is(.x, .y) .z, .w:not(.v) { }')).toEqual([
      'v',
      'w',
      'x',
      'y',
      'z',
    ]);
  });

  it('skips numbers, keyframe steps and at-rule preludes', () => {
    expect(
      css(
        '@keyframes s { 0% { } 50.5% { } to { } } @media (min-width: 40.5em) { .r { } } .a { margin: 1.5rem }',
      ),
    ).toEqual(['a', 'r']);
  });

  it('resolves & against the parent selector', () => {
    expect(
      collectStyleClasses(
        '.card { &__title { } &--active { } &.open { } .inner { &-deep { } } }',
        'scss',
        false,
      ),
    ).toEqual([
      'card',
      'card--active',
      'card__title',
      'inner',
      'inner-deep',
      'open',
    ]);
  });

  it('supports @at-root and parent lists', () => {
    expect(
      collectStyleClasses(
        '.a, .b { &__c { } @at-root .rooted { } }',
        'scss',
        false,
      ),
    ).toEqual(['a', 'a__c', 'b', 'b__c', 'rooted']);
  });

  it('drops interpolated names and skips // comments in SCSS and Less', () => {
    expect(
      collectStyleClasses(
        '// .gone { }\n.ok { } .x-#{$n} { } .@{p}-y { }',
        'scss',
        false,
      ),
    ).toEqual(['ok']);
    expect(collectStyleClasses('.@{p}-y { } .z { }', 'less', false)).toEqual([
      'z',
    ]);
  });

  it('does not take // inside a url as a comment', () => {
    expect(
      collectStyleClasses(
        '.a { background: url(http://x/y.png); } .b { }',
        'scss',
        false,
      ),
    ).toEqual(['a', 'b']);
  });

  it('reads the indented syntax of sass and stylus', () => {
    expect(
      collectStyleClasses(
        '// .gone\n.list\n  color: red\n  &-item\n    color: blue\n',
        'sass',
        false,
      ),
    ).toEqual(['list', 'list-item']);
    expect(
      collectStyleClasses(
        '.tab\n  color red\n  .inner\n    color blue\n',
        'stylus',
        false,
      ),
    ).toEqual(['inner', 'tab']);
  });

  it('counts only :global() names in CSS modules', () => {
    expect(
      collectStyleClasses(
        '.local { } :global(.shared) { } .local :global(.deep:not(.x)) { } :global(.a) :global(.b) { }',
        undefined,
        true,
      ),
    ).toEqual(['a', 'b', 'deep', 'shared', 'x']);
  });

  it('keeps @utility names, and the * that marks a wildcard utility', () => {
    expect(
      css(
        '@utility tab-4 { tab-size: 4; } @utility tab-* { tab-size: --value(integer); } @utility x-#{$n} { } .x- { }',
      ),
    ).toEqual(['tab-*', 'tab-4', 'x-']);
  });

  it('reads class names with non-ASCII characters', () => {
    expect(css('.café { } .été-x { } .emoji-\u{1F600} { }')).toEqual([
      'café',
      'emoji-\u{1F600}',
      'été-x',
    ]);
  });

  it('reads a quoted url() to its end even when it contains a parenthesis', () => {
    expect(
      css(
        `.a{background:url("data:image/svg+xml,%3Csvg fill='rgb(0,0,0)'/%3E")}.b{}.c{}`,
      ),
    ).toEqual(['a', 'b', 'c']);
    expect(css(`.a{background:url('data:x,"rgb(0,0,0)"')}.b{}.c{}`)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(css('.a{background:url( a.png )}.b{}')).toEqual(['a', 'b']);
  });

  it('reads the selector lists of @scope, with or without to', () => {
    expect(
      css(
        '@scope (.card) to (.content) { :scope { } .title { } } @scope (.panel, .sheet:not(.x)) { .body { } }',
      ),
    ).toEqual(['body', 'card', 'content', 'panel', 'sheet', 'title', 'x']);
    expect(css('@scope { :scope { } .inner { } } @scoped (.no) { }')).toEqual([
      'inner',
    ]);
    expect(
      collectStyleClasses(
        '@scope (.local) to (:global(.limit)) { :global(.inside) { } }',
        undefined,
        true,
      ),
    ).toEqual(['inside', 'limit']);
  });

  it('strips only unescaped attribute selectors', () => {
    expect(
      css(
        String.raw`.grid-areas-\[main\] { } .a[data-x="]"] { } .b\[x\]c[d] { } .e\\[f] { }`,
      ),
    ).toEqual(['a', 'b[x]c', 'e\\', 'grid-areas-[main]']);
  });

  it('survives unterminated input', () => {
    expect(css('.a { content: "open')).toEqual(['a']);
    expect(css('.a /* open')).toEqual([]);
    expect(css('.a { b: url(x')).toEqual(['a']);
    expect(css('.a { } #{open')).toEqual(['a']);
    expect(collectStyleClasses('.a // open', 'scss', false)).toEqual([]);
    expect(css('} .a { }')).toEqual(['a']);
  });
});

describe('virtualize styleClasses', () => {
  it('fills styleClasses from every style block', () => {
    expect(virtualize(fixture('styles-css.vue')).styleClasses).toEqual([
      'btn',
      'md:flex',
      'responsive',
    ]);
    expect(virtualize(fixture('styles-scss-less.vue')).styleClasses).toEqual([
      'card',
      'card--active',
      'card__title',
      'panel',
      'panel-header',
    ]);
    expect(virtualize(fixture('styles-indented.vue')).styleClasses).toEqual([
      'list',
      'list-item',
      'tab',
      'tab-inner',
    ]);
    expect(virtualize(fixture('styles-module.vue')).styleClasses).toEqual([
      'deep',
      'shared',
    ]);
    expect(virtualize(fixture('styles-tailwind.vue')).styleClasses).toEqual([
      'tab-*',
      'tab-4',
    ]);
  });

  it('reads @scope roots and limits and escaped brackets in a component', () => {
    expect(checked(fixture('styles-scope.vue')).styleClasses).toEqual([
      'body',
      'card',
      'content',
      'panel',
      'sheet',
      'title',
    ]);
    expect(
      checked(fixture('styles-escaped-brackets.vue')).styleClasses,
    ).toEqual(['a', 'grid-areas-[main]']);
  });

  it('still reads styles when the template is skipped', () => {
    const source = '<template lang="pug">p</template><style>.a { }</style>';
    expect(virtualize(source).styleClasses).toEqual(['a']);
  });

  it('leaves styleClasses empty without a style block', () => {
    expect(virtualize('<template><p></p></template>').styleClasses).toEqual([]);
  });
});
