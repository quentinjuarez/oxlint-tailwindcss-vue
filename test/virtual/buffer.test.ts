import { describe, expect, it } from 'vitest';

import { VirtualBuffer } from '../../src/virtual/buffer.js';
import { assertContract } from '../helpers/contract.js';

function openBuffer(source: string): VirtualBuffer {
  const buffer = new VirtualBuffer(source);
  buffer.begin();
  return buffer;
}

describe('VirtualBuffer', () => {
  it('blanks every UTF-16 unit to a space and keeps line breaks', () => {
    expect(new VirtualBuffer('a\r\nb\né😀').toString()).toBe(' \r\n \n   ');
  });

  it('places ;__( right to left on free ASCII slots', () => {
    const buffer = openBuffer('<p class="a">');
    expect(buffer.placeCall(3, 9, '__')).toBe(true);
    expect(buffer.toString()).toBe('     ;__(    ');
  });

  it('skips line breaks while placing the call', () => {
    const buffer = openBuffer('<p class\n=\n"a">');
    expect(buffer.placeCall(3, 11, '__')).toBe(true);
    expect(buffer.toString()).toBe('     ;__\n(\n    ');
  });

  it('refuses when the slots run out and leaves the buffer unchanged', () => {
    const buffer = openBuffer('<p class="a">');
    expect(buffer.placeCall(5, 8, '__')).toBe(false);
    expect(buffer.toString()).toBe(' '.repeat(13));
    expect(buffer.isFree(7)).toBe(true);
  });

  it('refuses when no run of adjacent slots fits the callee', () => {
    const buffer = openBuffer('a\nb\nc\nd');
    expect(buffer.placeCall(0, 7, '__')).toBe(false);
  });

  it('refuses when no slot is left for the semicolon', () => {
    const buffer = openBuffer('<p class="a">');
    expect(buffer.placeCall(6, 9, '__')).toBe(false);
  });

  it('clamps the upper bound to the source length', () => {
    const buffer = openBuffer('abcd');
    expect(buffer.placeCall(0, 99, '_')).toBe(true);
    expect(buffer.toString()).toBe(' ;_(');
  });

  it('never writes a slot twice', () => {
    const buffer = openBuffer('abcdef');
    buffer.write(4, 'x');
    expect(buffer.isFree(4)).toBe(false);
    expect(buffer.placeAfter(4, ')')).toBe(true);
    expect(buffer.toString()).toBe('    x)');
    expect(() => {
      buffer.write(4, 'y');
    }).toThrow(/already written/);
  });

  it('treats line breaks, non-ASCII characters and out of range indices as not free', () => {
    const buffer = new VirtualBuffer('a\né😀');
    expect(buffer.isFree(0)).toBe(true);
    expect(buffer.isFree(1)).toBe(false);
    expect(buffer.isFree(2)).toBe(false);
    expect(buffer.isFree(3)).toBe(false);
    expect(buffer.isFree(-1)).toBe(false);
    expect(buffer.isFree(99)).toBe(false);
  });

  it('refuses placeAfter without a free run and rejects writes out of range', () => {
    const buffer = openBuffer('ab\n');
    expect(buffer.placeAfter(2, ')')).toBe(false);
    expect(buffer.placeAfter(0, '))')).toBe(true);
    expect(buffer.placeAfter(0, ')')).toBe(false);
    expect(() => {
      buffer.write(3, 'x');
    }).toThrow(/out of range/);
  });

  it('keeps placeAfter below an exclusive limit', () => {
    const buffer = openBuffer('"a"\n >b');
    expect(buffer.placeAfter(3, ')', 4)).toBe(false);
    expect(buffer.placeAfter(3, '))', 5)).toBe(false);
    expect(buffer.placeAfter(3, ')', 6)).toBe(true);
    expect(buffer.toString()).toBe('   \n)  ');
  });

  it('copies source text at the same indices', () => {
    const buffer = openBuffer('a.b\nc.d');
    buffer.copy(2, 7);
    expect(buffer.toString()).toBe('  b\nc.d');
  });

  it('rollback restores the blanks of the open region', () => {
    const buffer = openBuffer('a b\nc d');
    buffer.write(0, 'x');
    buffer.copy(4, 7);
    buffer.rollback();
    expect(buffer.toString()).toBe('   \n   ');
    expect(buffer.isFree(0)).toBe(true);
  });

  it('undo restores a committed region and frees its slots', () => {
    const buffer = openBuffer('abcdef');
    buffer.write(1, 'x');
    const first = buffer.commit();
    buffer.begin();
    buffer.write(3, 'y');
    const second = buffer.commit();
    expect(buffer.regionAt(1)).toBe(first);
    expect(buffer.regionAt(3)).toBe(second);
    expect(buffer.regionAt(0)).toBeUndefined();
    buffer.undo(first);
    expect(buffer.toString()).toBe('   y  ');
    expect(buffer.isFree(1)).toBe(true);
    expect(buffer.regionAt(1)).toBeUndefined();
    expect(buffer.regionAt(3)).toBe(second);
    buffer.undo(first);
    expect(buffer.toString()).toBe('   y  ');
  });

  it('keeps a line break written by a copy and restores it after undo', () => {
    const buffer = openBuffer('a\nb');
    buffer.copy(0, 3);
    const region = buffer.commit();
    expect(buffer.toString()).toBe('a\nb');
    buffer.undo(region);
    expect(buffer.toString()).toBe(' \n ');
  });

  it('treats misuse of regions as a programming error', () => {
    const buffer = new VirtualBuffer('abc');
    expect(() => {
      buffer.write(0, 'x');
    }).toThrow(/no open region/);
    expect(() => {
      buffer.copy(0, 1);
    }).toThrow(/no open region/);
    expect(() => buffer.placeCall(0, 3, '_')).toThrow(/no open region/);
    expect(() => buffer.placeAfter(0, ')')).toThrow(/no open region/);
    expect(() => buffer.commit()).toThrow(/no open region/);
    expect(() => {
      buffer.rollback();
    }).toThrow(/no open region/);
    buffer.begin();
    expect(() => {
      buffer.begin();
    }).toThrow(/already open/);
  });
});

describe('assertContract', () => {
  it('accepts a valid pair', () => {
    const source = '<p class="a">';
    const buffer = openBuffer(source);
    buffer.placeCall(3, 9, '__');
    buffer.write(9, '`a`');
    buffer.placeAfter(12, ')');
    expect(() => {
      assertContract(source, buffer.toString());
    }).not.toThrow();
  });

  it('accepts a comment wrapper on an ASCII slot', () => {
    expect(() => {
      assertContract('<!-- x -->', '/*   x  */');
    }).not.toThrow();
  });

  it('rejects a length change', () => {
    expect(() => {
      assertContract('abc', '  ');
    }).toThrow(/length/);
  });

  it('rejects a moved line break', () => {
    expect(() => {
      assertContract('a\nb', '\n  ');
    }).toThrow(/line break mismatch at 0/);
    expect(() => {
      assertContract('a b', ' \n ');
    }).toThrow(/line break mismatch at 1/);
  });

  it('rejects a wrapper character on a non-ASCII slot', () => {
    expect(() => {
      assertContract('aé', ' ;');
    }).toThrow(/invalid character at 1/);
  });

  it('rejects a character that is neither blank, copied nor a wrapper', () => {
    expect(() => {
      assertContract('abc', ' x ');
    }).toThrow(/invalid character at 1/);
  });

  it('rejects code that Babel cannot parse', () => {
    expect(() => {
      assertContract('abc(', 'abc(');
    }).toThrow(/does not parse/);
  });
});
