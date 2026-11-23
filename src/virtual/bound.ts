import type {
  DirectiveNode,
  NodeTypes,
  SimpleExpressionNode,
} from '@vue/compiler-core';

import type { AttributeKind, AttributeMatcher } from './attributes.js';
import type { VirtualBuffer } from './buffer.js';
import { CLASS_CALLEE, OBJECT_VALUES_CALLEE, writeCall } from './call.js';
import type { Notice, SkipCode, SourceSpan } from './types.js';

const SIMPLE_EXPRESSION = 4 as NodeTypes.SIMPLE_EXPRESSION;
const CALLEES: Record<AttributeKind, string> = {
  class: CLASS_CALLEE,
  setting: OBJECT_VALUES_CALLEE,
};

type BabelNode = Exclude<SimpleExpressionNode['ast'], false | null | undefined>;

export interface BoundValue {
  exp: SimpleExpressionNode;
  kind: AttributeKind;
}

export function checkedExpression(
  prop: DirectiveNode,
  tag: string,
  matchAttribute: AttributeMatcher,
): BoundValue | undefined {
  const { arg, exp } = prop;
  if (
    prop.name !== 'bind' ||
    arg?.type !== SIMPLE_EXPRESSION ||
    !arg.isStatic ||
    exp?.type !== SIMPLE_EXPRESSION
  )
    return undefined;
  const kind = matchAttribute(tag, arg.content);
  return kind === undefined ? undefined : { exp, kind };
}

export function rewriteBound(
  buffer: VirtualBuffer,
  source: string,
  prop: DirectiveNode,
  { exp, kind }: BoundValue,
): number | SkipCode {
  if (exp.ast === false) return 'invalid-expression';
  if (exp.loc.source !== exp.content) return 'entity';
  const start = exp.loc.start.offset;
  const end = exp.loc.end.offset;
  return writeCall(buffer, source, CALLEES[kind], prop.loc, start, end, () =>
    buffer.copy(start, end),
  );
}

export function noteUnquotedKeys(
  prop: DirectiveNode,
  exp: SimpleExpressionNode,
  notices: Notice[],
): void {
  const { ast } = exp;
  if (prop.arg?.loc.source !== 'class' || !ast) return;
  const candidates = ast.type === 'ArrayExpression' ? ast.elements : [ast];
  for (const candidate of candidates) {
    if (candidate?.type !== 'ObjectExpression') continue;
    for (const property of candidate.properties) {
      if (
        property.type === 'SpreadElement' ||
        property.computed ||
        property.key.type !== 'Identifier'
      )
        continue;
      notices.push({
        code: 'unquoted-key',
        key: property.key.name,
        span: sourceSpan(exp, property.key),
      });
    }
  }
}

// Vue parses a bound value as `(${content})`, so a Babel offset is one past
// the source offset while the raw text equals the decoded content, which
// rewriteBound requires.
function sourceSpan(exp: SimpleExpressionNode, node: BabelNode): SourceSpan {
  const base = exp.loc.start.offset - 1;
  return {
    start: base + (node.start as number),
    end: base + (node.end as number),
  };
}
