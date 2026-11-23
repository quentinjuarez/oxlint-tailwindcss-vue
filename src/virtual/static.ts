import type { AttributeNode, TextNode } from '@vue/compiler-core';

import type { AttributeMatcher } from './attributes.js';
import type { VirtualBuffer } from './buffer.js';
import { CLASS_CALLEE, writeCall } from './call.js';
import type { SkipCode } from './types.js';

// Outside v-pre, compiler-core reads these names as directives; inside, they
// stay attributes that Vue renders as written.
const DIRECTIVE_SHAPED = /^(?:[#.:@]|v-)/;
const HTML_WHITESPACE_RUNS = /[\t\n\f\r ]+/g;
const QUOTE = /["'`]/;
const LINE_BREAK_OR_BACKSLASH = /[\n\r\\]/;
const VALID_ESCAPE =
  /\\(?:0(?!\d)|[^\dux]|x[\da-fA-F]{2}|u[\da-fA-F]{4}|u\{([\da-fA-F]+)\})/y;
const MAX_CODE_POINT = 0x10ffff;

type LiteralForm = 'template-literal' | 'original-quotes';

export function checkedValue(
  prop: AttributeNode,
  tag: string,
  matchAttribute: AttributeMatcher,
): TextNode | undefined {
  return prop.value &&
    !DIRECTIVE_SHAPED.test(prop.name) &&
    matchAttribute(tag, prop.name) !== undefined
    ? prop.value
    : undefined;
}

export function rewriteStatic(
  buffer: VirtualBuffer,
  source: string,
  prop: AttributeNode,
  value: TextNode,
): number | SkipCode {
  const start = value.loc.start.offset;
  const end = value.loc.end.offset;
  const quoted = source[start] === '"' || source[start] === "'";
  const inner = quoted
    ? source.slice(start + 1, end - 1)
    : source.slice(start, end);
  if (contentWithoutEntities(prop.name, inner) !== value.content)
    return 'entity';
  if (!quoted && QUOTE.test(inner)) return 'quote-in-unquoted-value';
  const form = literalForm(inner, quoted);
  if (!form) return 'invalid-escape';

  const open = quoted ? start : start - 1;
  const close = quoted ? end - 1 : end;
  if (!buffer.isFree(open) || !buffer.isFree(close)) return 'no-room';
  return writeCall(
    buffer,
    source,
    CLASS_CALLEE,
    prop.loc,
    open,
    close + 1,
    () => {
      if (form === 'original-quotes') {
        buffer.copy(open, close + 1);
      } else {
        buffer.write(open, '`');
        buffer.copy(open + 1, close);
        buffer.write(close, '`');
      }
    },
  );
}

// compiler-core condenses a class value on HTML whitespace and trims it; any
// other difference between the raw text and `value.content` is a decoded
// entity.
function contentWithoutEntities(name: string, raw: string): string {
  return name === 'class' ? raw.replace(HTML_WHITESPACE_RUNS, ' ').trim() : raw;
}

function literalForm(inner: string, quoted: boolean): LiteralForm | undefined {
  if (!inner.includes('`') && !inner.includes('${')) {
    return hasInvalidEscape(inner) ? undefined : 'template-literal';
  }
  return quoted && !LINE_BREAK_OR_BACKSLASH.test(inner)
    ? 'original-quotes'
    : undefined;
}

function hasInvalidEscape(text: string): boolean {
  let index = text.indexOf('\\');
  while (index !== -1) {
    VALID_ESCAPE.lastIndex = index;
    const escape = VALID_ESCAPE.exec(text);
    if (!escape || Number.parseInt(escape[1] ?? '0', 16) > MAX_CODE_POINT)
      return true;
    index = text.indexOf('\\', VALID_ESCAPE.lastIndex);
  }
  return false;
}
