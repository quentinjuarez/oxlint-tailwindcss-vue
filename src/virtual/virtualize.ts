import type {
  AttributeNode,
  ElementNode,
  ElementTypes,
  NodeTypes,
  SourceLocation,
  TemplateChildNode,
  TextNode,
} from '@vue/compiler-core';
import { parse } from '@vue/compiler-sfc';

import { createAttributeMatcher } from './attributes.js';
import { VirtualBuffer } from './buffer.js';
import type {
  Skip,
  SkipCode,
  SourceSpan,
  VirtualizeOptions,
  VirtualizeResult,
} from './types.js';

const CALLEE = '__';
const ELEMENT = 1 as NodeTypes.ELEMENT;
const ATTRIBUTE = 6 as NodeTypes.ATTRIBUTE;
const TEMPLATE_WRAPPER = 3 as ElementTypes.TEMPLATE;
const TEMPLATE_BLOCK = '<template>';

const HTML_WHITESPACE = /[\t\n\f\r ]/;
const HTML_WHITESPACE_RUNS = /[\t\n\f\r ]+/g;
const BEFORE_TAG_END = /[\t\n\f\r /]/;
const QUOTE = /["'`]/;
const LINE_BREAK_OR_BACKSLASH = /[\n\r\\]/;
const VALID_ESCAPE =
  /\\(?:0(?!\d)|[^\dux]|x[\da-fA-F]{2}|u[\da-fA-F]{4}|u\{([\da-fA-F]+)\})/y;
const MAX_CODE_POINT = 0x10ffff;

type LiteralForm = 'template-literal' | 'original-quotes';

export function virtualize(
  source: string,
  options: VirtualizeOptions = {},
): VirtualizeResult {
  const result: VirtualizeResult = {
    code: null,
    rewrites: [],
    skipped: [],
    notices: [],
    styleClasses: [],
  };
  const { template } = parse(source, { filename: 'component.vue' }).descriptor;
  if (!template) return result;
  const { ast } = template;
  if (template.attrs.src !== undefined || !ast) {
    result.skipped.push(templateSkip('template-src', template.loc));
    return result;
  }
  if (template.lang && template.lang !== 'html') {
    result.skipped.push(templateSkip('template-lang', template.loc));
    return result;
  }

  const buffer = new VirtualBuffer(source);
  const isChecked = createAttributeMatcher(options);
  forEachElement(ast.children, (element) => {
    for (const prop of element.props) {
      if (
        prop.type !== ATTRIBUTE ||
        !prop.value ||
        !isChecked(element.tag, prop.name)
      )
        continue;
      const code =
        element.tagType === TEMPLATE_WRAPPER
          ? 'template-wrapper'
          : rewriteStatic(buffer, source, prop, prop.value);
      const record = { attribute: prop.name, span: spanOf(prop.loc) };
      if (code) result.skipped.push({ code, ...record });
      else result.rewrites.push({ kind: 'static', ...record });
    }
  });
  result.code = buffer.toString();
  return result;
}

function rewriteStatic(
  buffer: VirtualBuffer,
  source: string,
  prop: AttributeNode,
  value: TextNode,
): SkipCode | undefined {
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
  buffer.begin();
  // Wrapper characters stay inside the attribute, the whitespace before it and
  // the run after its value up to the next attribute or the end of the tag
  // (contract invariant 3).
  if (
    !buffer.placeCall(
      whitespaceStart(source, prop.loc.start.offset),
      open,
      CALLEE,
    ) ||
    !buffer.placeAfter(close + 1, ')', tagRunEnd(source, end))
  ) {
    buffer.rollback();
    return 'no-room';
  }
  if (form === 'original-quotes') {
    buffer.copy(open, close + 1);
  } else {
    buffer.write(open, '`');
    buffer.copy(open + 1, close);
    buffer.write(close, '`');
  }
  buffer.commit();
  return undefined;
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

function whitespaceStart(source: string, index: number): number {
  let start = index;
  while (HTML_WHITESPACE.test(source.charAt(start - 1))) start--;
  return start;
}

function tagRunEnd(source: string, valueEnd: number): number {
  let end = valueEnd;
  while (BEFORE_TAG_END.test(source.charAt(end))) end++;
  return source[end] === '>' ? end + 1 : end;
}

function forEachElement(
  children: readonly TemplateChildNode[],
  visit: (element: ElementNode) => void,
): void {
  for (const child of children) {
    if (child.type !== ELEMENT) continue;
    visit(child);
    forEachElement(child.children, visit);
  }
}

function templateSkip(code: SkipCode, loc: SourceLocation): Skip {
  return { code, attribute: TEMPLATE_BLOCK, span: spanOf(loc) };
}

function spanOf(loc: SourceLocation): SourceSpan {
  return { start: loc.start.offset, end: loc.end.offset };
}
