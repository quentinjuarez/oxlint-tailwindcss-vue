import { describe, expect, it } from 'vitest';

import { createAttributeMatcher } from '../../src/virtual/attributes.js';

describe('createAttributeMatcher', () => {
  it('checks class on any element', () => {
    const match = createAttributeMatcher({});
    expect(match('div', 'class')).toBe(true);
    expect(match('MyButton', 'class')).toBe(true);
    expect(match('slot', 'class')).toBe(true);
  });

  it('checks the Transition class props, kebab and camel', () => {
    const match = createAttributeMatcher({});
    expect(match('Transition', 'enter-active-class')).toBe(true);
    expect(match('transition-group', 'moveClass')).toBe(true);
    expect(match('TransitionGroup', 'appearFromClass')).toBe(true);
    expect(match('div', 'enter-active-class')).toBe(false);
    expect(match('RouterLink', 'move-class')).toBe(false);
  });

  it('checks the router link class props', () => {
    const match = createAttributeMatcher({});
    expect(match('RouterLink', 'active-class')).toBe(true);
    expect(match('router-link', 'exactActiveClass')).toBe(true);
    expect(match('NuxtLink', 'active-class')).toBe(true);
    expect(match('nuxt-link', 'exact-active-class')).toBe(true);
    expect(match('Transition', 'active-class')).toBe(false);
  });

  it("adds the user's attributes in kebab and camel case", () => {
    const camel = createAttributeMatcher({ attributes: ['contentClass'] });
    expect(camel('UiCard', 'content-class')).toBe(true);
    expect(camel('UiCard', 'contentClass')).toBe(true);
    const kebab = createAttributeMatcher({ attributes: ['content-class'] });
    expect(kebab('UiCard', 'contentClass')).toBe(true);
    expect(kebab('UiCard', 'other')).toBe(false);
  });

  it("adds the user's attribute patterns", () => {
    const match = createAttributeMatcher({
      attributePatterns: ['^ui-.*-class$'],
    });
    expect(match('X', 'ui-head-class')).toBe(true);
    expect(match('X', 'ui-head')).toBe(false);
  });

  it('ignores className, which Vue does not use', () => {
    expect(createAttributeMatcher({})('div', 'className')).toBe(false);
    expect(
      createAttributeMatcher({ attributes: ['className'] })('div', 'className'),
    ).toBe(true);
  });

  it('ignores an invalid user pattern', () => {
    const match = createAttributeMatcher({ attributePatterns: ['(', '^x$'] });
    expect(match('X', 'class')).toBe(true);
    expect(match('X', 'x')).toBe(true);
  });
});
