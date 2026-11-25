# oxlint-tailwindcss-vue

oxlint-tailwindcss-vue is a CLI that lints the Tailwind CSS classes in Vue
templates with your own oxlint and oxlint-tailwindcss config. oxlint passes
only the `<script>` blocks of a `.vue` file to JS plugins, so
oxlint-tailwindcss alone never sees a `class` or `:class` written in a
`<template>`, and a typo there passes the lint silently.
oxlint-tailwindcss-vue checks those attributes with the rules you already
enabled, reports each finding at its line and column in the `.vue` file, also
applies the fixes of those rules with `--fix`, and needs no ESLint.

[![npm version](https://img.shields.io/npm/v/oxlint-tailwindcss-vue)](https://www.npmjs.com/package/oxlint-tailwindcss-vue)
[![CI](https://github.com/quentinjuarez/oxlint-tailwindcss-vue/actions/workflows/ci.yml/badge.svg)](https://github.com/quentinjuarez/oxlint-tailwindcss-vue/actions/workflows/ci.yml)

With this `src/components/SaveStatus.vue`:

```vue
<template>
  <div class="flex flex-shrink-0 items-center gap-2 p-4">
    <p :class="saved ? 'text-green-700' : 'text-grey-500'">Saved</p>
  </div>
</template>
```

oxlint-tailwindcss-vue reports the bad class in the static `class` and the one
in the `:class` expression:

```console
$ npx oxlint-tailwindcss-vue
src/components/SaveStatus.vue:2:14 error tailwindcss/no-deprecated-classes "flex-shrink-0" is deprecated in Tailwind v4. Use "shrink-0" instead.
src/components/SaveStatus.vue:3:43 error tailwindcss/no-unknown-classes "text-grey-500" is not a valid Tailwind class. Did you mean "text-gray-500"?

2 errors, 0 warnings in 1 file
```

On the same file, oxlint alone reports nothing and exits 0. This example is
`test/fixtures/projects/readme-example` in the repository.

## Quick start

Install oxlint-tailwindcss-vue with oxlint and oxlint-tailwindcss, using npm,
pnpm or Yarn:

```sh
npm install -D oxlint oxlint-tailwindcss oxlint-tailwindcss-vue
pnpm add -D oxlint oxlint-tailwindcss oxlint-tailwindcss-vue
yarn add -D oxlint oxlint-tailwindcss oxlint-tailwindcss-vue
```

oxlint-tailwindcss-vue reads your oxlint config, so it needs the setup that
oxlint-tailwindcss already asks for: `oxlint-tailwindcss` in `jsPlugins`, and
the CSS file that imports Tailwind CSS in `settings.tailwindcss.entryPoint`.
The example above uses this `.oxlintrc.json`:

```json
{
  "jsPlugins": ["oxlint-tailwindcss"],
  "settings": {
    "tailwindcss": { "entryPoint": "src/style.css" }
  },
  "rules": {
    "tailwindcss/no-unknown-classes": "error",
    "tailwindcss/no-conflicting-classes": "error",
    "tailwindcss/no-deprecated-classes": "error",
    "tailwindcss/enforce-canonical": "warn"
  }
}
```

Then run oxlint-tailwindcss-vue after oxlint in your `lint` script:

```json
{
  "scripts": {
    "lint": "oxlint && oxlint-tailwindcss-vue"
  }
}
```

oxlint checks the scripts and oxlint-tailwindcss-vue checks the templates, so
no finding is reported twice.

## Why doesn't oxlint-tailwindcss check classes in Vue templates?

oxlint lints
[only the `<script>` blocks](https://oxc.rs/docs/guide/usage/linter.html) of a
`.vue` file, and JS plugins such as oxlint-tailwindcss see only those blocks.
The [oxc compatibility page](https://oxc.rs/compatibility) marks Vue as
partial, "No template linting yet", and the
[oxlint-tailwindcss frameworks page](https://oxlint-tailwindcss.pages.dev/frameworks)
says "Classes written in a template are not checked yet." Template support
waits for oxc language plugins, proposed in
[oxc#21936](https://github.com/oxc-project/oxc/discussions/21936) with no
release date. Until then oxlint exits 0 on a template full of unknown classes,
so the gap is silent.

## What oxlint-tailwindcss-vue checks

oxlint-tailwindcss-vue runs every oxlint-tailwindcss rule enabled in your
oxlint config, with your rule options, settings and overrides, on these
template attributes:

| In a Vue template                                                                                                  | Checked                                                                                                                       |
| :----------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| `class`, with the value in double, single or no quotes, on one line or several                                     | Yes                                                                                                                           |
| `:class` and `v-bind:class` holding a string, a template literal, a ternary, an array or an object                 | Yes, except object keys without quotes                                                                                        |
| `enter-from-class`, `leave-to-class`, `move-class` and the other class props of `Transition` and `TransitionGroup` | Yes, in kebab or camel case                                                                                                   |
| `active-class` and `exact-active-class` on `RouterLink` and `NuxtLink`, and `prefetched-class` on `NuxtLink`       | Yes, in kebab or camel case                                                                                                   |
| Attributes named in `settings.tailwindcss.attributes` or matched by `settings.tailwindcss.attributePatterns`       | Yes, in kebab or camel case. An object is read like oxlint-tailwindcss reads one in a JSX attribute: its values, not its keys |
| HTML comments such as `<!-- oxlint-disable-next-line tailwindcss/no-unknown-classes -->`                           | Respected: `oxlint-disable`, `oxlint-enable`, `eslint-disable` and `eslint-enable`                                            |

Three rules never run on templates: `no-dark-without-light`,
`no-contradicting-variants` and `no-borrowed-component-styles` judge the class
list of a whole JSX element, and a template attribute reaches
oxlint-tailwindcss as a function argument.

What oxlint-tailwindcss-vue reports:

| Finding                                                                                                                                                                            | In the output                                                                                                                                                   | Exit code     |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------ |
| A class problem found by one of your rules                                                                                                                                         | The rule id, such as `tailwindcss/no-unknown-classes` (`tailwindcss(no-unknown-classes)` in `json`, or your plugin alias), with the severity set in your config | 1 on an error |
| A `.vue` file that Vue cannot parse, or a virtual file that oxlint cannot parse                                                                                                    | `not checked:` and the reason (`oxlint-tailwindcss-vue(not-checked)` in `json`, `not-checked` in `github`)                                                      | 1             |
| With `--debug`, a skipped attribute                                                                                                                                                | `skipped`, the reason code and the attribute, on stderr with `json` and `github`                                                                                | No effect     |
| With `--debug`, a fix that `--fix` refused                                                                                                                                         | `fix refused` and the reason code, on stderr with `json` and `github`                                                                                           | No effect     |
| With `--debug`, an object key without quotes at the top of `:class`, or in an array there                                                                                          | `notice unquoted-key` and the key, on stderr with `json` and `github`                                                                                           | No effect     |
| Text that oxlint or one of its JS plugins prints on stderr while linting, such as the oxlint-tailwindcss warning about a Tailwind CSS engine newer than the one it was tested with | The text as it is, on stderr, each line once                                                                                                                    | No effect     |

What oxlint-tailwindcss-vue skips, with the reason code that `--debug` prints:

| Code                                                     | Skipped                                                                                |
| :------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| `template-lang`                                          | A `<template lang="pug">`, or any `lang` other than `html`                             |
| `template-src`                                           | A `<template>` with a `src` attribute                                                  |
| `template-wrapper`                                       | A class on a `<template>` wrapper (`v-if`, `v-for`, a slot), which Vue does not render |
| `entity`                                                 | A value with an HTML entity such as `&amp;`                                            |
| `invalid-escape`                                         | A backslash sequence that is invalid in a JavaScript template literal                  |
| `invalid-expression`                                     | An expression that Vue itself rejects                                                  |
| `no-room`, `quote-in-unquoted-value`, `parse-safety-net` | An attribute that cannot be rewritten without moving a character                       |
| `sfc-parse-error`                                        | A file that Vue cannot parse, also reported as not checked                             |

`v-bind="{ class: classes }"` and dynamic arguments such as `:[name]` are not
checked either.

With `--fix`, oxlint-tailwindcss-vue refuses a fix that it cannot copy back to
the `.vue` file exactly, leaves that value as it is, and keeps its finding in
the report. `--debug` prints the reason code of each refused fix:

| Code               | Refused                                                                                                                                                                                                                                                |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse-error`      | Every fix of a file whose fixed virtual file does not parse                                                                                                                                                                                            |
| `regions-changed`  | Every fix of a file where a fix added or removed a value                                                                                                                                                                                               |
| `skeleton-changed` | A fix that changed the code around the strings of a value                                                                                                                                                                                              |
| `source-mismatch`  | A fix when the `.vue` text no longer matches the value that was fixed                                                                                                                                                                                  |
| `unsafe-value`     | A new text that holds the quote of its attribute, a backslash, a backtick, `${`, `&` followed by a letter or `#`, an ASCII control character other than tab or line feed, or, in a value without quotes, whitespace, a quote, `=`, `<`, `>` or nothing |
| `line-break`       | A fix that adds a line break or a carriage return, or a value that holds a lone CR, mixes CRLF and LF, or has a space or tab before a CRLF                                                                                                             |
| `changed-on-disk`  | The file changed during the run, or is not valid UTF-8, when its fixes were about to be written: nothing is written                                                                                                                                    |

## How oxlint-tailwindcss-vue works

1. **Select the files.** oxlint-tailwindcss-vue asks oxlint which files it
   would lint (`oxlint --debug=files`, with your paths and ignore options) and
   keeps the `.vue` files, so `.gitignore`, `ignorePatterns` and
   `--ignore-pattern` apply exactly as in oxlint.
2. **Write virtual files.** Each `.vue` file becomes a `.ts` file with the
   same length and the same line breaks. Every other character is blanked to
   spaces, then each class attribute is written back at its own offset,
   inside a call to a private function: `__`, added to the `callees` setting
   of oxlint-tailwindcss, or `___` for a bound value of an attribute from
   your settings. `___` is registered as a `cva` callee extractor, so
   oxlint-tailwindcss reads an object there by its values, as in a JSX
   attribute.
3. **Run oxlint.** oxlint runs once per oxlint config, on the virtual files in
   a temporary folder, with a config derived from yours: your Tailwind rules,
   settings and overrides, and your `respectEslintDisableDirectives` option,
   with the native rules off. The classes each component defines in its own
   `<style>` blocks are not added to an allowlist: their `no-unknown-classes`
   findings are dropped after the run.
4. **Map positions back.** oxlint reports UTF-8 byte offsets in the virtual
   file. oxlint-tailwindcss-vue converts each one to a UTF-16 index through the
   virtual text. That index is the same in the `.vue` file, which gives the
   line and column.

Positions are exact because the virtual file keeps the UTF-16 offsets of the
`.vue` file, and oxlint's byte offsets are mapped back through them: CRLF line
endings, a BOM, accents or emoji before a class do not shift a column. Line 2
of the example, then the same line in its virtual file:

```text
SaveStatus.vue      <div class="flex flex-shrink-0 items-center gap-2 p-4">
SaveStatus.vue.ts          ;__(`flex flex-shrink-0 items-center gap-2 p-4`)
```

With `--fix`, oxlint-tailwindcss-vue first writes fix-mode virtual files: the
same files, except that `\r\n` inside a template literal becomes a space and
`\n`, which keeps the ranges of the plugin's fixes exact. It runs oxlint with
`--fix` on them until nothing changes, in 10 passes at most, then compares the
tokens of each virtual file before and after, and copies back only the class
values that changed. It reads each `.vue` file again just before writing it, and
writes nothing if the file changed since it was read. Then it runs the normal
pipeline on the files as written, so the report shows what remains.

Without `--fix`, oxlint-tailwindcss-vue never writes to your project. With it,
the only change is to class values. The temporary folder is removed after the
run, even on Ctrl+C.

## Options

```text
oxlint-tailwindcss-vue [options] [paths...]
```

| Option                 | Effect                                                                                                                                                                                                                                                                                                                              |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`                | Files or folders to check, as with oxlint. Default: the current folder.                                                                                                                                                                                                                                                             |
| `-c, --config <path>`  | oxlint config file. Default: oxlint's lookup.                                                                                                                                                                                                                                                                                       |
| `--ignore-path <path>` | Passed to oxlint's file selection.                                                                                                                                                                                                                                                                                                  |
| `--ignore-pattern <p>` | Passed to oxlint's file selection. Repeatable.                                                                                                                                                                                                                                                                                      |
| `--no-ignore`          | Passed to oxlint's file selection.                                                                                                                                                                                                                                                                                                  |
| `-f, --format <name>`  | `default`, `json` or `github`.                                                                                                                                                                                                                                                                                                      |
| `--quiet`              | Report errors only.                                                                                                                                                                                                                                                                                                                 |
| `--max-warnings <n>`   | Exit 1 above `n` warnings. Default: `options.maxWarnings` of your root oxlint config.                                                                                                                                                                                                                                               |
| `--deny-warnings`      | Exit 1 on any warning. `options.denyWarnings: true` in your root oxlint config does the same.                                                                                                                                                                                                                                       |
| `--fix`                | Apply the fixes of the Tailwind rules to the `.vue` files, then report what remains. A fix that cannot be copied back exactly is refused, with the codes listed above.                                                                                                                                                              |
| `--debug`              | List skipped attributes and refused fixes with their reason, object keys without quotes in `:class`, and configs that do not load oxlint-tailwindcss. With the `default` format, the list comes after the findings. With `json` and `github`, it goes to stderr. With any format, print the stack of an unexpected error to stderr. |
| `-h, --help`           | Show the help.                                                                                                                                                                                                                                                                                                                      |
| `-V, --version`        | Show the version.                                                                                                                                                                                                                                                                                                                   |

Without `-c`, oxlint-tailwindcss-vue uses the nearest `.oxlintrc.json`,
`.oxlintrc.jsonc`, `oxlint.config.ts` or `oxlint.config.mts` of each `.vue`
file, in its folder or above. Files that share a config are linted in one
oxlint run, so a monorepo with one config per package works as with oxlint.
A config that does not load oxlint-tailwindcss is skipped, since oxlint does
not check Tailwind CSS classes there either, and `--debug` lists it with its
number of `.vue` files. oxlint-tailwindcss can be declared in the top-level
`jsPlugins` or in the `jsPlugins` of an override.

oxlint reads `options` only from the root config: the `-c` file, or the
config found from the current folder. oxlint-tailwindcss-vue does the same.
`options.maxWarnings` and `options.denyWarnings` count like `--max-warnings`
and `--deny-warnings` when the flag is absent; a flag wins, as in oxlint.
`options.respectEslintDisableDirectives` applies to the disable comments of
templates too.

Formats:

- `default`: one line per finding, `path:line:column severity rule message`,
  then a summary. Columns count UTF-16 code units, like editors. It is colored
  on a terminal. A non-empty `NO_COLOR` turns colors off, a non-empty
  `FORCE_COLOR` turns them on (it wins over `NO_COLOR`), and `FORCE_COLOR=0` or
  `FORCE_COLOR=false` turns them off. `json` and `github` are never colored.
- `json`: the shape of oxlint's `json` format (`diagnostics` and
  `number_of_files`) with the `.vue` paths. `offset`, `length` and `column`
  count UTF-8 bytes of the `.vue` file, as oxlint does for script blocks, so
  both reports can be merged.
- `github`: one workflow command per finding, so findings show up as
  annotations. Columns count UTF-16 code units.

When no `.vue` file matches, oxlint-tailwindcss-vue prints
`No .vue files to check.` and exits 0. With `json` and `github`, that notice
goes to stderr, like the `--debug` notes, so stdout holds only the report. In
every format, oxlint-tailwindcss-vue prints on stderr what oxlint and its JS
plugins print there while linting, each line once, even with `--quiet`.

Exit codes:

| Code | Meaning                                                                                                                                                                                                                                                                                                                            |
| :--- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | No error, and warnings within `--max-warnings` (or `options.maxWarnings`)                                                                                                                                                                                                                                                          |
| 1    | An error, a file that could not be parsed, or too many warnings                                                                                                                                                                                                                                                                    |
| 2    | Tool failure: an invalid option, oxlint missing or older than 1.94.0, no oxlint config, oxlint-tailwindcss loaded by no config, not installed or declared under two aliases, a path or CSS entry point not found, a listed `.vue` file that cannot be read, a fixed file that cannot be written, unexpected oxlint output or crash |
| 130  | Interrupted by SIGINT                                                                                                                                                                                                                                                                                                              |
| 143  | Interrupted by SIGTERM                                                                                                                                                                                                                                                                                                             |

## Use it from Node.js

oxlint-tailwindcss-vue exports the pipeline behind the CLI, with TypeScript
types:

```js
import { lint } from 'oxlint-tailwindcss-vue';

const { findings } = await lint({ cwd: process.cwd() });
for (const { file, start, rule, message } of findings) {
  console.log(`${file}:${start.line}:${start.column} ${rule} ${message}`);
}
```

`lint()` takes the file selection options of the CLI (`paths`, `config`,
`ignorePath`, `ignorePatterns`, `noIgnore`), `fix: true` to apply the fixes as
`--fix` does, and an abort `signal`. Next to `findings`, it returns `files`, one
report per `.vue` file with its skipped attributes and notices,
`skippedConfigs`, the configs that do not load oxlint-tailwindcss with their
number of `.vue` files, and `warningOptions`, the `denyWarnings` and
`maxWarnings` set in the `options` of the root oxlint config, which the CLI
applies to its exit code. When oxlint or one of its JS plugins prints on stderr
while linting, `oxlintStderr` holds that text, each line once, and the CLI
prints it on stderr. With `fix: true`, the report of a file holds `fixed: true`
when `lint()` wrote the file, and `refusedFixes`, each with a `code`, a `line`
and a `column`. `virtualize(source, options)` returns the virtual file of one
`.vue` source, with its rewrites and skipped attributes.

`lint()` rejects with a `ToolError` for a tool failure, such as a missing
oxlint, a missing path or a file that cannot be written. `ToolError` is
exported, with a `message` and an optional `hint`. When the `signal` is
aborted, `lint()` rejects with the reason of the signal. Any other error means
a bug, and is worth a report in the
[issues](https://github.com/quentinjuarez/oxlint-tailwindcss-vue/issues).

## Run it in CI and in a pre-commit hook

In GitHub Actions, the `github` format turns findings into annotations:

```yaml
- run: npx oxlint
- run: npx oxlint-tailwindcss-vue --format github
```

Run oxlint-tailwindcss-vue from the repository root: the annotation paths it
prints are relative to the current folder.

In a pre-commit hook, lint-staged passes the staged files to each command, so
only those files are checked:

```json
{
  "lint-staged": {
    "*.vue": ["oxlint", "oxlint-tailwindcss-vue"]
  }
}
```

## Requirements

- Node.js 22.18.0 or newer on the 22 line, or 24.11.0 or newer, as
  `@babel/parser` 8 requires: the LTS lines 22, 24 and 26. CI runs the tests on
  Node.js 22.18.0 and the latest 24 (Linux), and on 26 (Linux and Windows).
- oxlint 1.94.0 or newer, the first version whose `--print-config` keeps the
  settings of JS plugins and the options of their rules.
- oxlint-tailwindcss 1.17.2 or newer.
- Tailwind CSS 4.1.15 or newer, as oxlint-tailwindcss requires.
- Vue 3 single-file components.
- A `node_modules` install: npm, pnpm, or Yarn with `nodeLinker: node-modules`.

## Limitations

- Three oxlint-tailwindcss rules never run on templates:
  `no-dark-without-light`, `no-contradicting-variants` and
  `no-borrowed-component-styles`. They judge the class list of a whole JSX
  element, and a template attribute reaches the plugin as a function argument.
- Object keys without quotes in `:class`, as in `{ hidden: !open }`, are not
  checked, because oxlint-tailwindcss reads only quoted keys. `--debug` lists
  them for an object at the top of `:class` or directly in an array there,
  not for an object deeper down: in a ternary branch, an `&&` or `||`
  operand, a nested array or a call such as `cn({ hidden: !open })`.
- Some `:class` object keys are not read by oxlint-tailwindcss, as in JSX: a
  key whose value is a string, a number or a template literal, as in
  `{ 'p-2': 'yes' }`, and every key of an object behind a TypeScript `as` or
  `satisfies`.
- In an attribute from your `attributes` or `attributePatterns` settings,
  such as `:ui`, the values of a nested object are not read, as in JSX: in
  `{ body: { base: 'p-2' } }`, `p-2` is not checked. Keys named `variants`,
  `compoundVariants` and `defaultVariants` are read the way oxlint-tailwindcss
  reads a `cva()` config.
- With `"wrapLines": "all"`, `enforce-consistent-line-wrapping` can report a
  multi-line class value that is wrapped correctly. The rule reads the
  indentation of the line where the value starts, and in the virtual file the
  tag and attribute name before the value are blank, so they count as
  indentation. Keep such a value on one line, or set
  `"wrapLines": "overWidth"` for `**/*.vue` in an override.
- Templates in Pug or any `lang` other than HTML, and `<template src>`, are
  skipped.
- `--fix` does not apply `enforce-consistent-line-wrapping` in templates, and
  its findings stay in the report. The rule rebuilds a value from the
  indentation of its line, which the virtual file cannot give it.
- No editor diagnostics: findings appear in the terminal and in CI, not in
  your editor.
- Classes built at runtime, for example returned by a function or read from
  data, cannot be checked.
- Yarn Plug'n'Play is not supported: oxlint-tailwindcss-vue looks for oxlint
  in `node_modules`, and oxlint 1.94 cannot load oxlint-tailwindcss under
  Plug'n'Play either.

## FAQ

### Does oxlint-tailwindcss-vue replace oxlint?

No. oxlint-tailwindcss-vue checks only the class attributes of Vue templates,
with every native oxlint rule turned off, so run both:
`oxlint && oxlint-tailwindcss-vue`.

### Do I still need ESLint to lint Tailwind CSS classes in Vue templates?

No. oxlint-tailwindcss-vue runs your oxlint and oxlint-tailwindcss on the
templates, without ESLint or vue-eslint-parser.

### Does oxlint-tailwindcss-vue change my files?

Only with `--fix`, and then only class values. Without it,
oxlint-tailwindcss-vue only reads your project: the virtual files go to a
temporary folder that is removed after the run. With `--fix`, a value is
rewritten only when the new text can be copied back exactly, and a file that
changed during the run is not written.

### How do I disable a rule on one line of a Vue template?

Put an HTML comment on the line before:
`<!-- oxlint-disable-next-line tailwindcss/no-unknown-classes -->`.
`oxlint-disable`, `oxlint-enable`, `eslint-disable` and `eslint-enable`
comments work too; `eslint-*` comments follow
`options.respectEslintDisableDirectives` of your root oxlint config, as in
oxlint. Only comments inside `<template>` apply to it: not an HTML comment
before `<template>` at the top of the file, and not a `/* eslint-disable */`
in `<script>`. An `oxlint-disable-line` comment placed before the code on its
line does nothing, as in oxlint: put `oxlint-disable-next-line` on the line
before instead.

### Why is a class from my `<style>` block not reported as unknown?

oxlint-tailwindcss-vue drops the `no-unknown-classes` findings on the classes
a component defines in its own `<style>` blocks after the run, instead of
adding them to an allowlist, so your overrides of that rule still apply. A
wildcard `@utility fancy-*` covers every class that starts with `fancy-`. In
CSS modules, only `:global()` names count.

### Does oxlint-tailwindcss-vue work with Nuxt?

Yes: oxlint-tailwindcss-vue checks the pages, layouts and components of a
Nuxt 4 project under `app/`, dynamic routes such as `[id].vue` and the
`active-class`, `exact-active-class` and `prefetched-class` of `NuxtLink`
included, with no
Nuxt-specific option (see the test project `test/fixtures/projects/nuxt`).
Set `settings.tailwindcss.entryPoint` to the CSS file that imports Tailwind
CSS, relative to the oxlint config and without Nuxt's `~/` alias, such as
`app/assets/css/main.css`.

### Does oxlint-tailwindcss-vue support Svelte, Astro, Vue 2 or Tailwind CSS v3?

No. oxlint-tailwindcss-vue checks Vue 3 single-file components only, and
oxlint-tailwindcss requires Tailwind CSS 4.1.15 or newer.

### What happens when oxlint lints Vue templates itself?

oxlint-tailwindcss will check template classes directly: its frameworks page
says "Template support follows once oxlint makes it possible." The oxc work is
tracked in [oxc#21936](https://github.com/oxc-project/oxc/discussions/21936).

## Alternatives and related tools

| Tool                                                                                                                       | Tailwind classes in Vue templates                                                                                                                                                                                          | Notes                                                                                                                                          |
| :------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| oxlint-tailwindcss alone                                                                                                   | Not checked, documented: "Classes written in a template are not checked yet" ([frameworks page](https://oxlint-tailwindcss.pages.dev/frameworks))                                                                          | oxlint plugin; checks the `<script>` blocks of `.vue` files                                                                                    |
| [eslint-plugin-better-tailwindcss](https://github.com/schoero/eslint-plugin-better-tailwindcss)                            | Checked with ESLint and vue-eslint-parser, documented; "cannot currently lint Vue templates through Oxlint" ([Vue parser docs](https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/parsers/vue.md)) | ESLint plugin                                                                                                                                  |
| [tw-lint](https://github.com/dayflower/tw-lint)                                                                            | Checked, documented: "Lints HTML, JSX/TSX, Vue, Svelte, Astro, PHP and other template languages"                                                                                                                           | CLI on the Tailwind CSS language server, with the IntelliSense checks such as `cssConflict` and `suggestCanonicalClasses`; its own config file |
| [oxlint-vue](https://github.com/vad1ym/oxlint-vue)                                                                         | Not documented                                                                                                                                                                                                             | Replaces the `oxlint` command; lints template expressions with eslint-plugin-vue rules                                                         |
| [Vize](https://github.com/ubugeeei/vize)                                                                                   | Not documented                                                                                                                                                                                                             | Rust toolchain for Vue with its own linter and an oxlint plugin                                                                                |
| oxfmt [`sortTailwindcss`](https://oxc.rs/docs/guide/usage/formatter/config-file-reference.html#sorttailwindcss)            | Sorting only, documented: "Sort Tailwind CSS classes", with Vue in its languages                                                                                                                                           | Formatter option, disabled by default                                                                                                          |
| [prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss#sorting-non-standard-attributes) | Sorting only, documented: sorts `class` and `:class` by default                                                                                                                                                            | Prettier plugin; also removes duplicate classes                                                                                                |

## License

[MIT](LICENSE)
