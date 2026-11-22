import { describe, expect, it } from 'vitest';

import { VirtualBuffer } from '../../src/virtual/buffer.js';
import { undoUnparsable } from '../../src/virtual/safety-net.js';
import { assertContract } from '../helpers/contract.js';
import {
  checked,
  fixture,
  rewritten,
  skipped,
  spanOf,
} from '../helpers/virtual.js';

function withCopies(
  source: string,
  ranges: readonly (readonly [number, number])[],
): { buffer: VirtualBuffer; regions: number[] } {
  const buffer = new VirtualBuffer(source);
  const regions = ranges.map(([start, end]) => {
    buffer.begin();
    buffer.copy(start, end);
    return buffer.commit();
  });
  return { buffer, regions };
}

describe('virtualize: parse safety net', () => {
  it('blanks a rewrite that Babel rejects and records parse-safety-net', () => {
    const source = fixture('sfc/bound-strict-mode.vue');
    const result = checked(source);
    expect(skipped(source, result)).toEqual([
      ['parse-safety-net', `:class="static ? 'p-1' : 'm-1'"`],
      ['parse-safety-net', ':class="yield"'],
      ['parse-safety-net', `:class="010 && 'p-3'"`],
      ['parse-safety-net', `:class="'\\1' && 'p-5'"`],
    ]);
    expect(result.skipped[0]).toEqual({
      code: 'parse-safety-net',
      attribute: ':class',
      span: spanOf(source, `:class="static ? 'p-1' : 'm-1'"`),
    });
    for (const { span } of result.skipped) {
      expect(result.code.slice(span.start, span.end).trim()).toBe('');
    }
    expect(rewritten(source, result)).toEqual([
      'class="p-2"',
      `:class="'p-4'"`,
      'class="p-6"',
    ]);
  });

  it('blanks identifiers, keywords and parentheses Vue lets through', () => {
    const rejected = [
      ':class="ok\u{1F600}"',
      ':class="a\u00a0b"',
      ':class="a\u2028b"',
      ':class="if"',
      ':class="class"',
      ':class="a) => (b"',
    ];
    const source = [
      '<template>',
      ...rejected.flatMap((attribute, index) => [
        `<p ${attribute}></p>`,
        `<p class="p-${index}"></p>`,
      ]),
      `<p :class="'m-1'"></p>`,
      '</template>',
    ].join('\n');
    const result = checked(source);
    expect(skipped(source, result)).toEqual(
      rejected.map((attribute) => ['parse-safety-net', attribute]),
    );
    expect(rewritten(source, result)).toEqual([
      ...rejected.map((_, index) => `class="p-${index}"`),
      `:class="'m-1'"`,
    ]);
  });

  it('drops the notices of a blanked rewrite', () => {
    const source =
      '<template><p :class="{ gone: yield }"></p><p :class="{ kept: x }"></p></template>';
    const result = checked(source);
    expect(skipped(source, result)).toEqual([
      ['parse-safety-net', ':class="{ gone: yield }"'],
    ]);
    expect(result.notices).toEqual([
      { code: 'unquoted-key', key: 'kept', span: spanOf(source, 'kept') },
    ]);
  });

  it('blanks the whole file when no rewrite parses', () => {
    const source = '<template><p :class="static"></p></template>';
    const result = checked(source);
    expect(result.code.trim()).toBe('');
    expect(result.rewrites).toEqual([]);
    expect(skipped(source, result)).toEqual([
      ['parse-safety-net', ':class="static"'],
    ]);
  });
});

describe('undoUnparsable', () => {
  it('undoes the region at the error, or else the last region before it', () => {
    const atError = 'x\nstatic\ny\n';
    const first = withCopies(atError, [
      [0, 1],
      [2, 8],
      [9, 10],
    ]);
    const firstResult = undoUnparsable(first.buffer);
    expect(firstResult).toEqual({
      code: 'x\n      \ny\n',
      undone: [first.regions[1]],
    });
    assertContract(atError, firstResult.code);

    const beforeError = 'x\ny +\n';
    const second = withCopies(beforeError, [
      [0, 1],
      [2, 5],
    ]);
    const secondResult = undoUnparsable(second.buffer);
    expect(secondResult).toEqual({
      code: 'x\n   \n',
      undone: [second.regions[1]],
    });
    assertContract(beforeError, secondResult.code);
  });

  it('returns the fully blanked text when no region is left', () => {
    const source = 'static\n';
    const { buffer, regions } = withCopies(source, [[0, 6]]);
    const result = undoUnparsable(buffer);
    expect(result).toEqual({ code: '      \n', undone: regions });
    assertContract(source, result.code);
  });
});
