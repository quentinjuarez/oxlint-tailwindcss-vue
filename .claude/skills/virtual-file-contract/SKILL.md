---
name: virtual-file-contract
description: Use when changing how a Vue template attribute is written into the virtual file, when adding a fixture for a Vue construct, when a reported line or column is wrong, when oxlint fails to parse a virtual file, or when changing how class names are read from `<style>` blocks.
---

# Virtual file contract

oxlint reports UTF-8 byte offsets and byte columns on the virtual file. The CLI
maps them back to the `.vue` file through UTF-16 indices, which the contract
keeps identical. One invalid character makes oxlint drop every diagnostic of
the file, and one shifted line breaks every position after it. So the contract
is never bent to make a case pass: the attribute is skipped with a reason.

## Invariants (checked by the `assertContract` test helper on every fixture)

1. `virtual.length === source.length` (UTF-16 code units).
2. `source[i]` is `\n` or `\r` exactly when `virtual[i]` is the same character.
3. Every other character of `virtual` is one of:
   - an ASCII space (each UTF-16 unit of a blanked character, so an astral
     character becomes two spaces);
   - a character copied from `source` at the same index (the literal or the
     expression);
   - a wrapper character (`;`, `_`, `(`, `)`, a backtick) written on an index
     where `source` holds an ASCII character that is not a line break, either
     inside the attribute's span, in the whitespace just before it, or on the
     first free slot after the value, before the next attribute or the end of
     the tag (the closing `)` of a static value; no such slot means `no-room`).
4. No index is written twice. The rewriter tracks used slots; a rewrite that
   needs a used slot is skipped with `no-room`.
5. A skipped attribute stays blank, exactly like the text around it.
6. The virtual file parses as a TypeScript module with `@babel/parser`
   (`sourceType: 'module'`, plugin `typescript`).

## Rewrites

The private callee is `__`; the CLI adds it to `settings.tailwindcss.callees`.
The same rules apply to every checked attribute, not only `class`.

| Source                                 | Virtual                    | Notes                                                                                                         |
| :------------------------------------- | :------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `class="a b"` or `class='a b'`         | ``;__(`a b`)``             | quotes become backticks; `)` on the first free slot after the value, before the next attribute or the tag end |
| value spanning lines                   | template literal           | line breaks copied as they are, `\r` included (invariant 2)                                                   |
| value with a backtick or `${`          | original quotes kept       | only on one line without a backslash, else skip `invalid-escape`                                              |
| `:class="expr"`, `v-bind:class="expr"` | `;__(expr)`                | expression copied raw; `)` replaces the closing quote                                                         |
| `class=a` (unquoted)                   | backticks around the value | needs free slots on both sides, else skip `no-room`                                                           |

Wrapper characters are placed right to left, ending just before the value, on
slots that are not line breaks. So `class\n=\n"a"` becomes ``;__\n(\n`a`)``,
which is still one call. A short name such as `ui="a"` borrows the whitespace
before it: `<p ui="a">` becomes ``  ;__(`a`)`` (two blanks first).

## Skips (stable reason codes, shown by `--debug` and asserted in tests)

| Code                      | When                                                                                                                            |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| `entity`                  | the raw value differs from Vue's decoded value (`&amp;`, `&quot;`, `&#39;`)                                                     |
| `invalid-expression`      | Vue rejects the expression (`exp.ast === false`)                                                                                |
| `invalid-escape`          | a backslash sequence that is invalid in a template literal (`\201C`)                                                            |
| `quote-in-unquoted-value` | an unquoted value that contains a quote                                                                                         |
| `no-room`                 | not enough free slots for the wrapper                                                                                           |
| `template-wrapper`        | a class on `<template v-if>`, `v-for` or a slot (tagType 3): Vue does not render it                                             |
| `template-lang`           | `<template lang>` other than `html`                                                                                             |
| `template-src`            | `<template src>`                                                                                                                |
| `parse-safety-net`        | Babel still fails at this rewrite after every other rule                                                                        |
| `sfc-parse-error`         | Vue's own parser threw on this file, or the file ends inside the opening tag of a `v-pre` element: nothing in it can be checked |

## Checked attributes

- `class`, `:class`, `v-bind:class` on any element, component or slot outlet.
- Vue built-in class props, kebab or camel case, only on their components:
  - on `Transition`, `TransitionGroup`, `transition` and `transition-group`:
    `enter-from-class`, `enter-active-class`, `enter-to-class`,
    `leave-from-class`, `leave-active-class`, `leave-to-class`,
    `appear-from-class`, `appear-active-class`, `appear-to-class`,
    `move-class`;
  - on `RouterLink`, `router-link`, `NuxtLink` and `nuxt-link`:
    `active-class`, `exact-active-class`.
- Every name in the user's `settings.tailwindcss.attributes`, and every name
  matching `attributePatterns`.
- Unquoted object keys (`:class="{ active: x }"`) are copied, but
  oxlint-tailwindcss reads only quoted keys, so they are not checked;
  `--debug` lists them for `:class` and `v-bind:class` only (see the open
  question in docs/design.md). On other attributes, such as a `:ui` object,
  keys name slots, not classes.
- Never: dynamic arguments (`:[name]`), `v-bind="{ class }"` (0.1), other
  directives with a `class` argument (`@class`, `v-model:class`), anything
  inside `v-pre` except static attributes.

## Disable comments

An HTML comment whose text starts with `oxlint-disable`, `oxlint-enable`,
`eslint-disable` or `eslint-enable` becomes a JS block comment of the same
length at the same offsets: `<!--` becomes `/*` and two spaces, `-->` becomes a
space and `*/`, the text between is copied. A comment whose text contains `*/`
stays blank. Every other comment stays blank.

## Facts from @vue/compiler-sfc 3.5 to rely on

- Offsets are UTF-16, absolute in the whole SFC, BOM included, and
  `loc.source === source.slice(loc.start.offset, loc.end.offset)`.
- `prop.value.loc` includes the quotes. `prop.value.content` is decoded and, for
  `class`, condensed: never use it for positions; compare it with the raw text
  to detect entities.
- `prop.exp.loc` is raw without quotes; `prop.exp.content` is decoded.
  `exp.ast` is `null` for a simple identifier, `false` when Babel failed.
- Template comments are dropped when `NODE_ENV` is `production` unless
  `templateParseOptions: { comments: true }` is passed. A comment cut by the
  end of the file gets a `loc` that ends 3 past the source.
- compiler-core never resets its v-pre state when a file ends inside the
  opening tag that carries `v-pre` (after the whole name: whitespace, `=`,
  `:`, `.` or `/`): every later parse in the process would read directives as
  plain attributes. So `virtualize` first parses a file that contains `v-pre`
  with a suffix that ends any open tag (that parse closes the pending v-pre
  itself), reads from Vue's errors whether the file ends inside that tag, and
  then reports `sfc-parse-error` without ever parsing the file as it is.
- `template.ast` is a ROOT node. With a `lang` other than `html` it holds one
  raw text node; with `src` there is no `ast`.
- Use `@vue/compiler-sfc` ^3.5 from this package's dependencies, never the
  project's `vue/compiler-sfc` (Vue 2.7 has another API).

## Classes from `<style>`

Read with the tolerant tokenizer, never a regex over the raw text: skip
comments (and `//` in SCSS, Less, Stylus), strings and `url()`; split selectors
on top-level commas; resolve `&` against the parent selector; decode CSS
escapes (`.md\:flex` is `md:flex`); keep `@utility` names (a `-*` utility gives
a prefix); in CSS modules count only `:global()` names. Drop names built with
interpolation (`#{}`, `@{}`).

## Adding a case

1. Write the smallest `.vue` file that shows it under `test/fixtures/<area>/`
   (CRLF files under `test/fixtures/crlf/`).
2. Write the failing test: `assertContract`, then the expected rewritten
   regions or the expected skip code.
3. If the case produces findings, add an integration expectation with the line
   and column in the `.vue` file.
4. Make it pass without touching the invariants.

## Red flags

| Thought                                             | Reality                                                                 |
| :-------------------------------------------------- | :---------------------------------------------------------------------- |
| "Shift the wrapper by one character"                | it lands on a line break or another attribute: skip `no-room`           |
| "Use `value.content`, it is cleaner"                | it is decoded and condensed: positions and class names change           |
| "Write `;__(` over the `\n`, it is only whitespace" | every later line moves up by one                                        |
| "oxlint gave column 41, report 41"                  | that is a byte column of the virtual file: map through the UTF-16 index |
| "Skip the Babel check, oxlint will tell us"         | oxlint then drops every finding of the file                             |
