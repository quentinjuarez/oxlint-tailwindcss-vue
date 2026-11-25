import { readFileSync, writeFileSync } from 'node:fs';

function fixLiteral(context, node, next) {
  const text = context.sourceCode.getText(node);
  const fixed = next(text);
  if (fixed === text) return;
  context.report({
    node,
    message: 'fixable',
    fix: (fixer) => fixer.replaceText(node, fixed),
  });
}

console.warn('[fix-plugin] loaded');

export default {
  meta: { name: 'tailwindcss' },
  rules: {
    count: {
      meta: { fixable: 'code' },
      create: (context) => ({
        TemplateLiteral: (node) =>
          fixLiteral(context, node, (text) =>
            text.replace(/p-(\d+)/, (_, n) => `p-${Number(n) + 1}`),
          ),
      }),
    },
    quote: {
      meta: { fixable: 'code' },
      create: (context) => ({
        TemplateLiteral: (node) =>
          fixLiteral(context, node, (text) =>
            text.replace('p-2', 'content-["x"]'),
          ),
      }),
    },
    wrap: {
      meta: { fixable: 'code' },
      create: (context) => ({
        CallExpression: (node) => {
          const [argument] = node.arguments;
          if (argument?.type === 'TemplateLiteral') {
            fixLiteral(context, argument, (text) => `[${text}]`);
          }
        },
      }),
    },
    touch: {
      meta: { fixable: 'code', schema: false },
      create: (context) => ({
        Program: () => {
          const [{ file, from, text }] = context.options;
          if (
            context.filename.endsWith('.vue.ts') &&
            readFileSync(file, 'utf8') === from
          ) {
            writeFileSync(file, text);
          }
        },
        TemplateLiteral: (node) =>
          fixLiteral(context, node, (text) => text.replace('p-2', 'p-4')),
      }),
    },
  },
};
