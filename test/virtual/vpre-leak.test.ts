import { describe, expect, it } from 'vitest';

import type { VirtualizeResult } from '../../src/virtual/types.js';
import { virtualize } from '../../src/virtual/virtualize.js';
import { checked, rewritten } from '../helpers/virtual.js';

const CLASS_BINDING = `<template><p :class="{ 'p-2': x }"></p></template>`;

function expectBoundChecks(after: string): void {
  expect(
    rewritten(CLASS_BINDING, checked(CLASS_BINDING)),
    `bound attributes after ${JSON.stringify(after)}`,
  ).toEqual([`:class="{ 'p-2': x }"`]);
}

function unparsed(source: string): VirtualizeResult {
  return {
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
  };
}

describe('virtualize: truncated v-pre tags', () => {
  it.each([
    '<template><p class="p-1"></p><p v-pre',
    '<template><div v-pre><p class="p-1"></p><b class="b',
    '<template><div v-pre><p class="p-1"></p><b v-pre ',
    '<template><p title="v-pre" class="p-1"></p><b class="b',
    '<template><div v-pre class="p-1">text',
    '<template><div v-pre class="p-1"></div',
    '<template><p class="p-1"></p><!-- <b v-pre ',
    '<template><p v-pre class="p-1"></p><b v-.',
  ])('parses %j as before, with no v-pre state left', (source) => {
    expect(rewritten(source, checked(source))).toEqual(['class="p-1"']);
    expectBoundChecks(source);
  });

  it('keeps a file truncated inside a v-pre tag from disabling checks in later files', () => {
    const truncated = '<template>\n  <p class="p-1"></p>\n  <p v-pre id=\'x';
    const result = virtualize(truncated);
    expectBoundChecks(truncated);
    expect(result).toEqual(unparsed(truncated));
  });

  it.each([
    '<template><p v-pre ',
    '<template><p v-pre\r',
    '<template><p v-pre=',
    '<template><p v-pre="x',
    '<template><p v-pre=x',
    '<template><p v-pre:a',
    '<template><p v-pre.m',
    '<template><p v-pre/',
    '<template><p v-pre class="a>b',
    '<template><p v-pre title="&amp',
    '<template><p :class="a" v-pre\n',
    '<template><img v-pre ',
    '<template><div><textarea v-pre ',
    '<template v-pre ',
    '<template><p class="p-1"></p></template>\n<docs v-pre ',
  ])(
    'reports %j as sfc-parse-error and keeps later files checked',
    (source) => {
      const result = virtualize(source);
      expectBoundChecks(source);
      expect(result).toEqual(unparsed(source));
    },
  );
});
