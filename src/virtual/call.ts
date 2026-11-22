import type { SourceLocation } from '@vue/compiler-core';

import type { VirtualBuffer } from './buffer.js';
import type { SkipCode } from './types.js';

const CALLEE = '__';
const HTML_WHITESPACE = /[\t\n\f\r ]/;
const BEFORE_TAG_END = /[\t\n\f\r /]/;

// Wrapper characters stay inside the attribute, the whitespace before it and
// the run after it up to the next attribute or the end of the tag (contract
// invariant 3): `;__(` ends just before `valueStart`, `)` takes the first free
// slot from `valueEnd`.
export function writeCall(
  buffer: VirtualBuffer,
  source: string,
  attribute: SourceLocation,
  valueStart: number,
  valueEnd: number,
  writeValue: () => void,
): SkipCode | undefined {
  buffer.begin();
  if (
    !buffer.placeCall(
      whitespaceStart(source, attribute.start.offset),
      valueStart,
      CALLEE,
    ) ||
    !buffer.placeAfter(valueEnd, ')', tagRunEnd(source, attribute.end.offset))
  ) {
    buffer.rollback();
    return 'no-room';
  }
  writeValue();
  buffer.commit();
  return undefined;
}

function whitespaceStart(source: string, index: number): number {
  let start = index;
  while (HTML_WHITESPACE.test(source.charAt(start - 1))) start--;
  return start;
}

function tagRunEnd(source: string, attributeEnd: number): number {
  let end = attributeEnd;
  while (BEFORE_TAG_END.test(source.charAt(end))) end++;
  return source[end] === '>' ? end + 1 : end;
}
