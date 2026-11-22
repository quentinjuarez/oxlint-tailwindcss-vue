import type { CommentNode } from '@vue/compiler-core';

import type { VirtualBuffer } from './buffer.js';

const DIRECTIVES = [
  'oxlint-disable',
  'oxlint-enable',
  'eslint-disable',
  'eslint-enable',
];
const HTML_OPEN = '<!--';
const HTML_CLOSE = '-->';

export function rewriteComment(
  buffer: VirtualBuffer,
  source: string,
  comment: CommentNode,
): number | undefined {
  const { content } = comment;
  const text = content.trimStart();
  const start = comment.loc.start.offset;
  const close = comment.loc.end.offset - HTML_CLOSE.length;
  // compiler-core ends a comment cut by the end of the file with a `-->` that
  // is not in the source: its loc ends 3 past the end of the source.
  if (
    !DIRECTIVES.some((directive) => text.startsWith(directive)) ||
    content.includes('*/') ||
    !source.startsWith(HTML_CLOSE, close)
  )
    return undefined;
  buffer.begin();
  buffer.write(start, '/*  ');
  buffer.copy(start + HTML_OPEN.length, close);
  buffer.write(close, ' */');
  return buffer.commit();
}
