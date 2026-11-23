export interface Position {
  line: number;
  column: number;
  byteColumn: number;
  offset: number;
  byteOffset: number;
}

const BYTE_ORDER_MARK = 0xfeff;

// Editors hide a byte order mark, so line 1 starts after it. Byte columns keep
// counting its three bytes, as oxlint does.
export function columnOf(
  text: string,
  lineStart: number,
  offset: number,
): number {
  const visibleStart =
    lineStart === 0 && text.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : lineStart;
  return Math.max(offset - visibleStart, 0) + 1;
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

function indexOfEveryByte(text: string): Int32Array {
  const indexes: number[] = [];
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index) as number;
    for (let byte = utf8Length(codePoint); byte > 0; byte--)
      indexes.push(index);
    index += codePoint > 0xffff ? 2 : 1;
  }
  indexes.push(text.length);
  return Int32Array.from(indexes);
}

function scanOriginal(text: string): {
  byteOffsets: Uint32Array;
  lineStarts: number[];
} {
  const byteOffsets = new Uint32Array(text.length + 1);
  const lineStarts = [0];
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index) as number;
    const units = codePoint > 0xffff ? 2 : 1;
    byteOffsets[index] = bytes;
    if (units === 2) byteOffsets[index + 1] = bytes;
    bytes += utf8Length(codePoint);
    index += units;
    const isBreak =
      codePoint === 10 || (codePoint === 13 && text.charCodeAt(index) !== 10);
    if (isBreak) lineStarts.push(index);
  }
  byteOffsets[text.length] = bytes;
  return { byteOffsets, lineStarts };
}

function lineOf(lineStarts: number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((lineStarts[middle] as number) <= index) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function createPositionMapper(
  original: string,
  virtual: string,
): (virtualByteOffset: number) => Position {
  const indexes = indexOfEveryByte(virtual);
  const { byteOffsets, lineStarts } = scanOriginal(original);
  const lastByte = indexes.length - 1;

  return (virtualByteOffset) => {
    const clamped = Math.min(
      Math.max(Math.trunc(virtualByteOffset) || 0, 0),
      lastByte,
    );
    const offset = Math.min(indexes[clamped] as number, original.length);
    const line = lineOf(lineStarts, offset);
    const lineStart = lineStarts[line] as number;
    const byteOffset = byteOffsets[offset] as number;
    return {
      line: line + 1,
      column: columnOf(original, lineStart, offset),
      byteColumn: byteOffset - (byteOffsets[lineStart] as number) + 1,
      offset,
      byteOffset,
    };
  };
}
