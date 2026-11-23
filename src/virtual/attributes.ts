import type { VirtualizeOptions } from './types.js';

const TRANSITION_TAGS = new Set([
  'Transition',
  'TransitionGroup',
  'transition',
  'transition-group',
]);
const ROUTER_LINK_TAGS = new Set([
  'RouterLink',
  'router-link',
  'NuxtLink',
  'nuxt-link',
]);

const toCamel = (name: string): string =>
  name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const toKebab = (name: string): string =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const withForms = (names: readonly string[]): string[] =>
  names.flatMap((n) => [n, toCamel(n), toKebab(n)]);

const TRANSITION_PROPS = new Set(
  withForms([
    ...['enter', 'leave', 'appear'].flatMap((phase) =>
      ['from', 'active', 'to'].map((step) => `${phase}-${step}-class`),
    ),
    'move-class',
  ]),
);
const ROUTER_LINK_PROPS = new Set(
  withForms(['active-class', 'exact-active-class']),
);

function compilePatterns(patterns: readonly string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern));
    } catch {
      continue;
    }
  }
  return compiled;
}

export type AttributeKind = 'class' | 'setting';

export type AttributeMatcher = (
  tag: string,
  name: string,
) => AttributeKind | undefined;

export function createAttributeMatcher(
  options: VirtualizeOptions,
): AttributeMatcher {
  const userNames = new Set(withForms(options.attributes ?? []));
  const patterns = compilePatterns(options.attributePatterns ?? []);
  return (tag, name) => {
    if (
      name === 'class' ||
      (TRANSITION_TAGS.has(tag) && TRANSITION_PROPS.has(name)) ||
      (ROUTER_LINK_TAGS.has(tag) && ROUTER_LINK_PROPS.has(name))
    )
      return 'class';
    if (userNames.has(name)) return 'setting';
    const forms = withForms([name]);
    return patterns.some((pattern) => forms.some((form) => pattern.test(form)))
      ? 'setting'
      : undefined;
  };
}
