import type {
  ElementNode,
  ElementTypes,
  NodeTypes,
  SourceLocation,
  TemplateChildNode,
} from '@vue/compiler-core';
import { parse, parseCache, type SFCTemplateBlock } from '@vue/compiler-sfc';

import { createAttributeMatcher } from './attributes.js';
import { checkedExpression, noteUnquotedKeys, rewriteBound } from './bound.js';
import { VirtualBuffer } from './buffer.js';
import { checkedValue, rewriteStatic } from './static.js';
import type {
  Rewrite,
  Skip,
  SkipCode,
  SourceSpan,
  VirtualizeOptions,
  VirtualizeResult,
} from './types.js';

const ELEMENT = 1 as NodeTypes.ELEMENT;
const ATTRIBUTE = 6 as NodeTypes.ATTRIBUTE;
const TEMPLATE_WRAPPER = 3 as ElementTypes.TEMPLATE;
const TEMPLATE_BLOCK = '<template>';

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
  let template: SFCTemplateBlock | null;
  try {
    template = parse(source, {
      filename: 'component.vue',
      sourceMap: false,
    }).descriptor.template;
  } catch {
    // compiler-core 3.5 throws on some invalid attributes, such as `v-.trim`.
    result.skipped.push({
      code: 'sfc-parse-error',
      attribute: TEMPLATE_BLOCK,
      span: { start: 0, end: source.length },
    });
    return result;
  } finally {
    // compiler-sfc keeps up to 500 parse results keyed by the whole source;
    // each file is read once, so the cache would only hold memory.
    parseCache.clear();
  }
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
    const isWrapper = element.tagType === TEMPLATE_WRAPPER;
    for (const prop of element.props) {
      if (prop.type === ATTRIBUTE) {
        const value = checkedValue(prop, element.tag, isChecked);
        if (!value) continue;
        const code = isWrapper
          ? 'template-wrapper'
          : rewriteStatic(buffer, source, prop, value);
        record(result, 'static', prop.name, prop.loc, code);
      } else {
        const exp = checkedExpression(prop, element.tag, isChecked);
        if (!exp) continue;
        const code = isWrapper
          ? 'template-wrapper'
          : rewriteBound(buffer, source, prop, exp);
        // compiler-core sets rawName on every directive it parses.
        record(result, 'bound', prop.rawName as string, prop.loc, code);
        if (!code) noteUnquotedKeys(exp, result.notices);
      }
    }
  });
  result.code = buffer.toString();
  return result;
}

function record(
  result: VirtualizeResult,
  kind: Rewrite['kind'],
  attribute: string,
  loc: SourceLocation,
  code: SkipCode | undefined,
): void {
  const span = spanOf(loc);
  if (code) result.skipped.push({ code, attribute, span });
  else result.rewrites.push({ kind, attribute, span });
}

function forEachElement(
  children: readonly TemplateChildNode[],
  visit: (element: ElementNode) => void,
): void {
  const pending = children.toReversed();
  while (pending.length > 0) {
    const node = pending.pop() as TemplateChildNode;
    if (node.type !== ELEMENT) continue;
    visit(node);
    for (let index = node.children.length - 1; index >= 0; index--) {
      pending.push(node.children[index] as TemplateChildNode);
    }
  }
}

function templateSkip(code: SkipCode, loc: SourceLocation): Skip {
  return { code, attribute: TEMPLATE_BLOCK, span: spanOf(loc) };
}

function spanOf(loc: SourceLocation): SourceSpan {
  return { start: loc.start.offset, end: loc.end.offset };
}
