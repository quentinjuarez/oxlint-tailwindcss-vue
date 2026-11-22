import { parse, type ParseError } from '@babel/parser';

import type { VirtualBuffer } from './buffer.js';

export interface SafetyNetResult {
  code: string;
  undone: number[];
}

export function undoUnparsable(buffer: VirtualBuffer): SafetyNetResult {
  const undone: number[] = [];
  for (;;) {
    const code = buffer.toString();
    const position = syntaxErrorAt(code);
    // Blank text always parses, so Babel stops on or after a slot that some
    // live region wrote.
    const region =
      position === undefined ? undefined : regionAtOrBefore(buffer, position);
    if (region === undefined) return { code, undone };
    buffer.undo(region);
    undone.push(region);
  }
}

function syntaxErrorAt(code: string): number | undefined {
  try {
    parse(code, { sourceType: 'module', plugins: ['typescript'] });
    return undefined;
  } catch (error) {
    return (error as ParseError).pos;
  }
}

function regionAtOrBefore(
  buffer: VirtualBuffer,
  position: number,
): number | undefined {
  let index = position;
  while (index >= 0 && buffer.regionAt(index) === undefined) index--;
  return buffer.regionAt(index);
}
