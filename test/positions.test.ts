import { describe, expect, it } from 'vitest';

import { createPositionMapper } from '../src/positions.js';

function blank(original: string, keepFrom: number, keepTo: number): string {
  let out = '';
  for (let i = 0; i < original.length; i++) {
    const char = original[i] as string;
    const keep = i >= keepFrom && i < keepTo;
    out += char === '\n' || char === '\r' || keep ? char : ' ';
  }
  return out;
}

function mapperFor(original: string, literal: string) {
  const start = original.indexOf(literal);
  const virtual = blank(original, start, start + literal.length);
  return { start, map: createPositionMapper(original, virtual), virtual };
}

describe('createPositionMapper', () => {
  it('maps a literal after a multi-byte first line', () => {
    const original = 'é\n  <p class="x">';
    const { start, map } = mapperFor(original, '"x"');
    expect(map(start)).toEqual({
      line: 2,
      column: 12,
      byteColumn: 12,
      offset: start,
      byteOffset: 1 + start,
    });
  });

  it('counts UTF-16 units for column and UTF-8 bytes for byteColumn', () => {
    const original = 'Été \u{1F600} <p class="x">';
    const { start, map } = mapperFor(original, '"x"');
    expect(map(start)).toEqual({
      line: 1,
      column: 17,
      byteColumn: 21,
      offset: start,
      byteOffset: 21 - 1,
    });
  });

  it('finds the line in a CRLF file', () => {
    const original = 'a\r\nb\r\n<p class="x">';
    const { start, map } = mapperFor(original, '"x"');
    expect(map(start)).toMatchObject({ line: 3, column: 10, byteColumn: 10 });
  });

  it('treats a lone CR as a line break', () => {
    const original = 'a\rb\r<p class="x">';
    const { start, map } = mapperFor(original, '"x"');
    expect(map(start)).toMatchObject({ line: 3, column: 10 });
  });

  it('does not split CRLF into two lines', () => {
    const original = 'a\r\nb';
    const map = createPositionMapper(original, original);
    expect(map(3)).toMatchObject({ line: 2, column: 1, offset: 3 });
  });

  it('maps an offset past the end to the last position', () => {
    const original = 'é\nab';
    const virtual = ' \nab';
    const map = createPositionMapper(original, virtual);
    expect(map(1000)).toEqual({
      line: 2,
      column: 3,
      byteColumn: 3,
      offset: 4,
      byteOffset: 5,
    });
    expect(map(-5)).toMatchObject({ line: 1, column: 1, offset: 0 });
  });

  it('maps an offset inside a multi-byte virtual character to its start', () => {
    const original = 'aéb';
    const map = createPositionMapper(original, original);
    expect(map(1)).toMatchObject({ column: 2, offset: 1 });
    expect(map(2)).toMatchObject({ column: 2, offset: 1 });
    expect(map(3)).toMatchObject({ column: 3, offset: 2, byteOffset: 3 });
  });

  it('maps an astral character kept in the virtual text', () => {
    const original = '\u{1F600}x';
    const map = createPositionMapper(original, original);
    expect(map(4)).toMatchObject({
      column: 3,
      byteColumn: 5,
      offset: 2,
      byteOffset: 4,
    });
    expect(map(2)).toMatchObject({ column: 1, offset: 0 });
  });

  it('answers 10 000 lookups on a 400 KB file quickly', () => {
    const line = '<p class="é flex">text</p>\n';
    const original = line.repeat(Math.ceil(400_000 / line.length));
    const virtual = original.replace(/[^\n]/g, ' ');
    const map = createPositionMapper(original, virtual);
    const size = virtual.length;
    const begin = performance.now();
    for (let i = 0; i < 10_000; i++) map((i * 7919) % size);
    expect(performance.now() - begin).toBeLessThan(500);
  });
});
