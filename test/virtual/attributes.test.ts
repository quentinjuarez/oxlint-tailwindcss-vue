import { describe, expect, it } from 'vitest';

import { createAttributeMatcher } from '../../src/virtual/attributes.js';

describe('createAttributeMatcher', () => {
  it('checks class on any element', () => {
    const match = createAttributeMatcher({});
    expect(match('div', 'class')).toBe('class');
    expect(match('MyButton', 'class')).toBe('class');
    expect(match('slot', 'class')).toBe('class');
  });

  it('checks the Transition class props, kebab and camel', () => {
    const match = createAttributeMatcher({});
    expect(match('Transition', 'enter-active-class')).toBe('class');
    expect(match('transition-group', 'moveClass')).toBe('class');
    expect(match('TransitionGroup', 'appearFromClass')).toBe('class');
    expect(match('div', 'enter-active-class')).toBeUndefined();
    expect(match('RouterLink', 'move-class')).toBeUndefined();
  });

  it('checks the router link class props', () => {
    const match = createAttributeMatcher({});
    expect(match('RouterLink', 'active-class')).toBe('class');
    expect(match('router-link', 'exactActiveClass')).toBe('class');
    expect(match('NuxtLink', 'active-class')).toBe('class');
    expect(match('nuxt-link', 'exact-active-class')).toBe('class');
    expect(match('Transition', 'active-class')).toBeUndefined();
  });

  it("adds the user's attributes in kebab and camel case", () => {
    const camel = createAttributeMatcher({ attributes: ['contentClass'] });
    expect(camel('UiCard', 'content-class')).toBe('setting');
    expect(camel('UiCard', 'contentClass')).toBe('setting');
    const kebab = createAttributeMatcher({ attributes: ['content-class'] });
    expect(kebab('UiCard', 'contentClass')).toBe('setting');
    expect(kebab('UiCard', 'other')).toBeUndefined();
  });

  it("adds the user's attribute patterns", () => {
    const match = createAttributeMatcher({
      attributePatterns: ['^ui-.*-class$'],
    });
    expect(match('X', 'ui-head-class')).toBe('setting');
    expect(match('X', 'ui-head')).toBeUndefined();
  });

  it("matches the user's patterns against the name in kebab and camel case", () => {
    const camel = createAttributeMatcher({ attributePatterns: ['ClassName$'] });
    expect(camel('UCard', 'content-class-name')).toBe('setting');
    expect(camel('UCard', 'contentClassName')).toBe('setting');
    expect(camel('UCard', 'content-class')).toBeUndefined();
    const kebab = createAttributeMatcher({
      attributePatterns: ['^content-class$'],
    });
    expect(kebab('UCard', 'contentClass')).toBe('setting');
    expect(kebab('UCard', 'contentClassName')).toBeUndefined();
  });

  it('keeps class and the class props of Vue components as class', () => {
    const match = createAttributeMatcher({
      attributes: ['class', 'active-class'],
      attributePatterns: ['class'],
    });
    expect(match('div', 'class')).toBe('class');
    expect(match('RouterLink', 'active-class')).toBe('class');
    expect(match('Transition', 'leave-to-class')).toBe('class');
    expect(match('div', 'active-class')).toBe('setting');
    expect(match('div', 'leave-to-class')).toBe('setting');
  });

  it('ignores className, which Vue does not use', () => {
    expect(createAttributeMatcher({})('div', 'className')).toBeUndefined();
    expect(
      createAttributeMatcher({ attributes: ['className'] })('div', 'className'),
    ).toBe('setting');
  });

  it('ignores an invalid user pattern', () => {
    const match = createAttributeMatcher({ attributePatterns: ['(', '^x$'] });
    expect(match('X', 'class')).toBe('class');
    expect(match('X', 'x')).toBe('setting');
  });
});
