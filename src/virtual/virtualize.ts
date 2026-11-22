import type {
  CommentNode,
  ElementNode,
  ElementTypes,
  NodeTypes,
  SourceLocation,
  TemplateChildNode,
} from '@vue/compiler-core';
import {
  parse,
  parseCache,
  type SFCStyleBlock,
  type SFCTemplateBlock,
} from '@vue/compiler-sfc';

import { createAttributeMatcher } from './attributes.js';
import { checkedExpression, noteUnquotedKeys, rewriteBound } from './bound.js';
import { VirtualBuffer } from './buffer.js';
import { rewriteComment } from './comments.js';
import { undoUnparsable } from './safety-net.js';
import { checkedValue, rewriteStatic } from './static.js';
import { collectStyleClasses } from './style-classes.js';
import type {
  Rewrite,
  Skip,
  SkipCode,
  SourceSpan,
  VirtualizeOptions,
  VirtualizeResult,
} from './types.js';
import { endsInsideVPreTag } from './vpre-guard.js';

const ELEMENT = 1 as NodeTypes.ELEMENT;
const COMMENT = 3 as NodeTypes.COMMENT;
const ATTRIBUTE = 6 as NodeTypes.ATTRIBUTE;
const TEMPLATE_WRAPPER = 3 as ElementTypes.TEMPLATE;
const TEMPLATE_BLOCK = '<template>';
const COMMENT_ATTRIBUTE = 'comment';

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
  if (endsInsideVPreTag(source)) {
    result.skipped.push(unparsedFile(source));
    return result;
  }
  let template: SFCTemplateBlock | null;
  let styles: SFCStyleBlock[];
  try {
    const { descriptor } = parse(source, {
      filename: 'component.vue',
      sourceMap: false,
      // compiler-core drops template comments by default when NODE_ENV is
      // production (it then loads its prod build).
      templateParseOptions: { comments: true },
    });
    template = descriptor.template;
    styles = descriptor.styles;
  } catch {
    // compiler-core 3.5 throws on some invalid attributes, such as `v-.trim`.
    result.skipped.push(unparsedFile(source));
    return result;
  } finally {
    // compiler-sfc keeps up to 500 parse results keyed by the whole source;
    // each file is read once, so the cache would only hold memory.
    parseCache.clear();
  }
  result.styleClasses = [
    ...new Set(
      styles.flatMap(({ content, lang, module }) =>
        collectStyleClasses(
          content,
          lang,
          module !== undefined && module !== false,
        ),
      ),
    ),
  ].toSorted();
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
  const regions = new Map<number, Rewrite>();
  const record = (
    kind: Rewrite['kind'],
    attribute: string,
    loc: SourceLocation,
    outcome: number | SkipCode,
  ): boolean => {
    const span = spanOf(loc);
    if (typeof outcome === 'string') {
      result.skipped.push({ code: outcome, attribute, span });
      return false;
    }
    const rewrite = { kind, attribute, span };
    result.rewrites.push(rewrite);
    regions.set(outcome, rewrite);
    return true;
  };
  forEachNode(ast.children, (node) => {
    if (node.type === COMMENT) {
      const region = rewriteComment(buffer, source, node);
      if (region !== undefined)
        record('comment', COMMENT_ATTRIBUTE, node.loc, region);
      return;
    }
    const isWrapper = node.tagType === TEMPLATE_WRAPPER;
    for (const prop of node.props) {
      if (prop.type === ATTRIBUTE) {
        const value = checkedValue(prop, node.tag, isChecked);
        if (!value) continue;
        const outcome = isWrapper
          ? 'template-wrapper'
          : rewriteStatic(buffer, source, prop, value);
        record('static', prop.name, prop.loc, outcome);
      } else {
        const exp = checkedExpression(prop, node.tag, isChecked);
        if (!exp) continue;
        const outcome = isWrapper
          ? 'template-wrapper'
          : rewriteBound(buffer, source, prop, exp);
        // compiler-core sets rawName on every directive it parses.
        if (record('bound', prop.rawName as string, prop.loc, outcome))
          noteUnquotedKeys(prop, exp, result.notices);
      }
    }
  });
  const { code, undone } = undoUnparsable(buffer);
  result.code = code;
  // Every region the buffer commits comes from a recorded rewrite.
  recordUndone(
    result,
    undone.map((region) => regions.get(region) as Rewrite),
  );
  return result;
}

function recordUndone(
  result: VirtualizeResult,
  undone: readonly Rewrite[],
): void {
  if (undone.length === 0) return;
  result.rewrites = result.rewrites.filter(
    (rewrite) => !undone.includes(rewrite),
  );
  result.notices = result.notices.filter(
    (notice) => !undone.some(({ span }) => isWithin(notice.span, span)),
  );
  result.skipped = [
    ...result.skipped,
    ...undone.map(({ attribute, span }): Skip => ({
      code: 'parse-safety-net',
      attribute,
      span,
    })),
  ].toSorted((a, b) => a.span.start - b.span.start);
}

function forEachNode(
  children: readonly TemplateChildNode[],
  visit: (node: ElementNode | CommentNode) => void,
): void {
  const pending = children.toReversed();
  while (pending.length > 0) {
    const node = pending.pop() as TemplateChildNode;
    if (node.type === COMMENT) {
      visit(node);
    } else if (node.type === ELEMENT) {
      visit(node);
      for (let index = node.children.length - 1; index >= 0; index--) {
        pending.push(node.children[index] as TemplateChildNode);
      }
    }
  }
}

function unparsedFile(source: string): Skip {
  return {
    code: 'sfc-parse-error',
    attribute: TEMPLATE_BLOCK,
    span: { start: 0, end: source.length },
  };
}

function templateSkip(code: SkipCode, loc: SourceLocation): Skip {
  return { code, attribute: TEMPLATE_BLOCK, span: spanOf(loc) };
}

function spanOf(loc: SourceLocation): SourceSpan {
  return { start: loc.start.offset, end: loc.end.offset };
}

function isWithin(inner: SourceSpan, outer: SourceSpan): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}
