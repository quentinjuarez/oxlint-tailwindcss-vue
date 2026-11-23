# Design: oxlint-tailwindcss-vue

Status: draft for review, 2026-11-20. Versions studied: oxlint 1.94.0,
oxlint-tailwindcss 1.17.2, tailwindcss 4.3.5, @vue/compiler-sfc 3.5.46.

## Problem

oxlint passes only the `<script>` blocks of a `.vue` file to JS plugins, so
oxlint-tailwindcss never sees the classes written in a Vue `<template>`. The oxc
compatibility page says "No template linting yet" for Vue, and the plugin's
documentation says "Classes written in a template are not checked yet". Official
support depends on oxc language plugins (oxc#21936), which have no release date.
In a Vue app most classes live in templates, so a typo there passes the lint
silently. The usual workaround is to keep ESLint for templates only.

## Goals

1. Check every class attribute of Vue SFC templates with the user's own
   oxlint-tailwindcss rules, options and settings. Three rules judge a whole
   JSX element and never run through a function call: `no-dark-without-light`,
   `no-contradicting-variants` and `no-borrowed-component-styles` (see "Open
   question").
2. Report each finding at the exact line and column of the `.vue` file.
3. Need no configuration beyond the existing oxlint config.
4. Never crash or report a wrong position on a valid Vue file. What cannot be
   checked safely is skipped, with a reason available in `--debug` output.
5. Stay fast: one oxlint process per config group, not one per file.

## Non-goals for 0.1

- Not an oxlint plugin: a plugin cannot report outside the `<script>` range
  (oxc#20465). The package is a CLI that runs next to oxlint.
- No editor integration.
- No linting of `<script>` blocks: oxlint already does it.
- No `--fix` (planned for 0.2, see "Fixes").
- No Svelte, Astro, Vue 2 or Pug templates.
- No merged report with the native oxlint run: users chain
  `oxlint && oxlint-tailwindcss-vue`.

## Anti-goals

- A wrong line or column. It is worse than no report.
- A report that also comes from the native oxlint run.
- False reports on classes the component defines in its own `<style>`.
- Writing to the user's project. 0.1 is read-only.

## Approaches considered

| Approach                                                      | Result                                                                                  | Decision                                  |
| :------------------------------------------------------------ | :-------------------------------------------------------------------------------------- | :---------------------------------------- |
| Convert the whole SFC to JSX (vue-oxc-parser 0.1.2)           | 17 of 93 real files crash the converter, 30 more give invalid JSX                       | Rejected                                  |
| An oxlint JS plugin that reads the template itself            | oxlint refuses reports outside the `<script>` range                                     | Rejected until oxc ships language plugins |
| Tailwind language server (tw-lint)                            | Works on templates, but other checks: no unknown or duplicate classes, no oxlint config | Different tool, listed as an alternative  |
| Offset-preserving virtual files run through the user's oxlint | 93 of 93 files, 621 class attributes, 0 parse errors, about 1 s                         | Chosen                                    |

## How it works

1. **Select files.** Run `oxlint --debug=files` with the user's paths and
   ignore flags, in the user's cwd, and keep the `.vue` entries. This honors
   `.gitignore`, `ignorePatterns` and `--ignore-pattern` exactly like oxlint.
2. **Read the config.** For each file, find the nearest oxlint config (or the
   user's `-c`) and flatten it with `oxlint --print-config`.
3. **Virtualize.** Parse each file with `@vue/compiler-sfc` and build a virtual
   `.ts` file (see "Virtual file contract").
4. **Derive a config** per group of files sharing a config and a CSS entry
   point (see "Derived config").
5. **Run oxlint once per group** on the virtual files in a temp dir. A group
   whose config loads oxlint-tailwindcss nowhere is not linted, and `--debug`
   prints `skipped <N> .vue files: <config> does not load oxlint-tailwindcss`.
6. **Map back** each diagnostic to the original file, line and column.
7. **Report and exit** (see "Output" and "Exit codes").

## Virtual file contract

The virtual file has the same length as the `.vue` file in UTF-16 code units
and the same line breaks at the same indices. Every character is replaced by
an ASCII space (two spaces for an astral character) except `\n` and `\r`, then
each checked class attribute is written back at its original offset inside a
call to a private callee. `__`, added to `settings.tailwindcss.callees`, wraps
every static value and the bound values of `class` and of Vue's class props.
`___` wraps the bound value of an attribute checked only because of the
`attributes` or `attributePatterns` settings:

| In the template                                | In the virtual file         |
| :--------------------------------------------- | :-------------------------- |
| `class="flex p-2"`                             | ``  ;__(`flex p-2`)``       |
| `:class="{ 'p-2': x }"`                        | `    ;__({ 'p-2': x })`     |
| `v-bind:class="[a, 'p-2']"`                    | `          ;__([a, 'p-2'])` |
| `:ui="{ root: 'p-2' }"`, with `ui` in settings | `;___({ root: 'p-2' })`     |

Rules:

1. The literal or expression keeps its exact offset, so the plugin reports it
   at the right place.
2. Wrapper characters go only on blanked ASCII slots that are not line breaks:
   inside the attribute's own span, in the whitespace just before it, or, for
   the closing `)` of a static value, on the first such slot after the value
   and before the next attribute or the end of the tag.
   No slot is written twice. When there is no room, the attribute is skipped,
   and a skipped attribute stays blank.
3. Static values become template literals, so backslashes and line breaks keep
   their raw value; line breaks stay exactly as in the source, `\r` included.
   (`--fix` in 0.2 will need `\r\n` written as ` \n`, because the plugin
   sizes fix ranges on the LF-normalized raw value; reports do not depend on
   it.) A value with a backtick or `${` keeps its original quotes when
   it fits on one line without a backslash; otherwise it is skipped.
4. The virtual file must parse as a TypeScript module. It is parsed with
   `@babel/parser`; on an error, the rewrite at the error offset (or, between
   rewrites, the last one before it) is blanked with its notices, and the file
   is parsed again until it parses.
5. Skipped, with a reason: values with HTML entities, expressions Vue itself
   rejects (`exp.ast === false`), invalid escape sequences, unquoted values
   that contain quotes, classes on `<template>` wrappers (`v-if`, `v-for`,
   slots), which Vue does not render, templates with a `lang` other than HTML,
   `<template src>`, files that Vue's own parser throws on, and files that
   end inside the opening tag of a `v-pre` element (parsing them would switch
   off directives in every later file).
6. Checked attributes: `class`, `:class`, `v-bind:class`, the class props of
   Vue's built-in components (`Transition`, `TransitionGroup`, `RouterLink`),
   and every attribute listed in the user's oxlint-tailwindcss `attributes` or
   `attributePatterns` settings, in kebab or camel case. A bound value of an
   attribute from these settings is read like the plugin reads a JSX
   attribute: in an object, the values and never the keys, which name slots
   (`:ui="{ root: 'p-2' }"`). `__` would read quoted keys as classes, so the
   CLI registers `___` as `calleeExtractors: { ___: 'cva' }`: the cva
   extractor reads an object argument's values through the plugin's general
   extractor, as `extractObjectValues` does for a JSX attribute. As in JSX,
   the values of a nested object are not read, while its quoted keys are, as
   in a `:class` object. `;___(` needs five free slots, under the same
   placement rules.
7. Disable comments: an HTML comment whose text starts with `oxlint-disable`,
   `oxlint-enable`, `eslint-disable` or `eslint-enable` becomes a JS block
   comment of the same length at the same offsets (`<!--` becomes `/*` and two
   spaces, `-->` becomes a space and `*/`), so
   `<!-- oxlint-disable-next-line tailwindcss/no-unknown-classes -->` works in
   a template. A comment whose text contains `*/` stays blank.

The full rule set, with one fixture per case, lives in the
`virtual-file-contract` skill and in `test/fixtures/`.

## Derived config

Written to the temp root and passed with `-c`, so no config near the temp files
can interfere:

- `plugins: []`, `categories: {}`, `ignorePatterns: []`.
- `jsPlugins`: the absolute path of the user's oxlint-tailwindcss, resolved
  from the config directory with the import conditions, declared once at the
  top level with the user's alias. The plugin is looked up in the printed
  top-level `jsPlugins` and in every `overrides[].jsPlugins`; declarations with
  the same alias count as one, different aliases are a tool failure.
- `settings.tailwindcss`: the user's block, with `entryPoint` made absolute,
  `__` added to `callees` and `___: 'cva'` added to the user's
  `calleeExtractors` (oxlint-tailwindcss also registers every extractor name
  as a callee).
- `rules`: only the `tailwindcss/*` rules (or the user's alias), with option
  paths made absolute.
- `overrides`: the user's overrides reduced to the Tailwind rules. No per-file
  allowlist override is written: it would be replaced by any user override of
  `no-unknown-classes` (see "Classes defined in `<style>`").
- Every user glob, in override `files` and in `entryPoint` mapping `files`,
  gets `.ts` appended, or `/*.ts` after a final `**` or `/` (oxlint does not
  recurse on `**.ts`). Only virtual files are linted, and the suffix keeps
  exactly the `.vue` files the glob matched: `**/*.ts` stays away from
  templates, `**/*.{js,vue}` and `src/legacy/**` reach them.

`extends` is not used: it drops `settings` and `ignorePatterns`.

## Running oxlint

```
node <oxlint bin> -c <tmp>/<group>/.oxlintrc.json --format json -A all
  --no-error-on-unmatched-pattern <virtual paths>
```

- oxlint is resolved from the user's project and spawned with
  `process.execPath`, never through a `.cmd` shim.
- `-A all` turns the native rules off; only the Tailwind rules remain.
- Each config group gets a folder in the temp root with its derived config.
  A virtual file keeps its path relative to the config folder (a file outside
  it goes under `_external/<drive>/`), and the child cwd mirrors the user's
  cwd, so override globs (relative to the config folder) and `entryPoint`
  mapping globs (relative to the cwd) match as in a native run. A cwd outside
  the config folder cannot be mirrored next to its files: mapping globs
  written for it do not match.
- Paths are explicit, in chunks below the Windows command-line limit. A
  directory walk would be emptied by a `.gitignore` above the temp dir.
- Paths are relative to the child cwd, or absolute when they leave it: oxlint
  1.94 exits with "PATH must not contain .." on a relative path with `..`.
- `--quiet`, `--max-warnings` and `--deny-warnings` are never passed to the
  child: the CLI applies them itself on the mapped results.
- The CLI checks that `number_of_files` equals the number of paths sent.

## Mapping back

oxlint reports UTF-8 byte offsets and byte columns. The CLI converts the byte
offset to a UTF-16 index through the virtual text, which equals the index in
the `.vue` file, then computes the line and column on the original text. On
line 1, a byte order mark is not counted in the UTF-16 column: editors hide
it. The byte offset and the byte column keep counting its three bytes, as
oxlint does on a script. Paths come back relative to the child cwd, absolute,
or as `file://` URLs (JetBrains terminals); all three are handled. A message
that contains a virtual path is rewritten to the original path. A theme file
path the plugin wrote relative to the child cwd is rewritten relative to the
user's cwd.

## Classes defined in `<style>`

A tolerant tokenizer reads the `<style>` blocks: it skips comments (and `//` in
SCSS, Less and Stylus), strings and `url()`, splits selectors on top-level
commas, resolves `&` against the parent selector, decodes CSS escapes, keeps
`@utility` names, and counts only `:global()` names in CSS modules. The two
selector lists of `@scope (<roots>) to (<limits>)` define classes too, and an
attribute selector is stripped only when its bracket is not escaped, so
`.grid-areas-\[main\]` defines `grid-areas-[main]`. The names are not passed
to the plugin: after the run, a `no-unknown-classes` finding whose message
starts with `"<class>"` for a class of the file's `<style>` is dropped, before
findings are counted. An integration test pins the plugin's message format.

## Output

- `default`: one line per finding, `path:line:column severity rule message`,
  then a summary. Colors through `util.styleText`, which honors `NO_COLOR`.
  Columns count UTF-16 code units, like editors and clickable terminal links
  (a byte order mark is not counted).
- `json`: oxlint's JSON shape and units, with original paths: `offset`,
  `length` and `column` count UTF-8 bytes of the `.vue` file, exactly as oxlint
  reports script blocks, so both outputs can be merged.
- `github`: workflow commands, so findings show up as annotations in pull
  requests. Columns count UTF-16 code units.

## Exit codes

| Code     | Meaning                                                                                                                                                                 |
| :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0        | No error, and warnings within `--max-warnings`                                                                                                                          |
| 1        | At least one error, a virtual file oxlint could not parse, or warnings over the limit                                                                                   |
| 2        | Tool failure: oxlint not found, no config group loads oxlint-tailwindcss, a listed file that cannot be read, missing CSS entry point, unexpected oxlint output or crash |
| 130, 143 | Interrupted by SIGINT or SIGTERM                                                                                                                                        |

## Command line

```
oxlint-tailwindcss-vue [options] [paths...]

  -c, --config <path>       oxlint config file (default: oxlint's lookup)
      --ignore-path <path>  passed to oxlint's file selection
      --ignore-pattern <p>  passed to oxlint's file selection, repeatable
      --no-ignore           passed to oxlint's file selection
  -f, --format <name>       default, json or github
      --quiet               report errors only
      --max-warnings <n>    exit 1 above n warnings
      --deny-warnings       exit 1 on any warning
      --debug               list skipped attributes with their reason
  -h, --help
  -V, --version
```

## Programmatic API

- `virtualize(source, options)` returns the virtual code, the rewritten regions
  and the skipped attributes with their reason.
- `lint(options)` runs the whole pipeline and returns the mapped diagnostics.

## Temp files and signals

- The temp root is `realpath(mkdtemp(realpath(os.tmpdir())/oxlint-tailwindcss-vue-))`.
- It is removed in `finally` and on SIGINT, SIGTERM, SIGHUP and SIGBREAK, after
  the child has exited (Windows refuses to delete files still open).
- Stale temp roots older than a day are pruned at start. A temp root holds a
  marker file, and only folders with the prefix and the marker are pruned.
- The plugin's own cache in the temp dir is never touched (its folder,
  `oxlint-tailwindcss-<user>`, can share the prefix on Windows).

## Fixes (0.2)

Fixes change lengths and line counts, so they cannot be copied back by offset.
The validated strategy: run `--fix` in a loop until nothing changes, compare
the token skeletons of the virtual file before and after, and copy back only
changed string tokens whose original text still matches. A fix is refused when
the file no longer parses, the skeleton changes, the file changed on disk, or
the new value contains its quote character, a backslash, a backtick or `${`.

## Testing

- **Fixture corpus:** about 30 `.vue` fixtures (quoting, line breaks around
  `=`, CRLF, BOM, non-ASCII text, escapes, entities, every `:class` shape,
  TypeScript in expressions, invalid expressions, directive forms, elements,
  template wrappers, `v-pre`, template blocks, broken templates, style
  dialects). Each test checks the contract: same UTF-16 length, same line
  breaks, valid TypeScript, expected rewrites and skips.
- **Property-based tests** with fast-check on random attribute layouts and
  values: the contract must hold for every input.
- **Integration tests** that run the real oxlint and oxlint-tailwindcss on
  fixture projects and assert each finding's line and column in the `.vue`
  file, on Linux and Windows.
- **Acceptance** on a real app before each release (paint-emoji: 93 files).
- Coverage thresholds: 95% statements, functions and lines, 90% branches.

## Acceptance of 0.1

Run on 2026-11-22 from the root of paint-emoji (a05849c), read-only, with
oxlint-tailwindcss-vue 0.1.0 built from 604911a, oxlint 1.94.0,
oxlint-tailwindcss 1.17.2, tailwindcss 4.3.5, Vue 3.5.44, @vue/compiler-sfc
3.5.46 and Node 26.13.1, on macOS 27.2 with an Apple M4 and 16 GB of RAM:

- 93 `.vue` files, 621 class attributes (577 static, 44 bound), no skipped
  attribute and no `unquoted-key` notice.
- The 8 findings of the spike, at the same lines and columns, in the
  `default`, `json` and `github` formats (exit 1), and no false positive. The
  20 unknown-class reports of the spike (`mat`, `checker`, `sheet-fade` and
  others) are classes each component defines in its own `<style>`; the
  filter on the file's `<style>` classes removes them.
- 0.63 to 0.93 s wall clock over six default runs (0.93 s for the first),
  against 0.45 s for the native oxlint run, which reports no diagnostic on its
  386 files.
- The README example (`test/fixtures/projects/readme-example`) prints the same
  output from the packed tarball installed with npm 11.20.0, pnpm 9.15.0 and
  Yarn 3.8.6 with `nodeLinker: node-modules`, and through lint-staged 17.6.2
  with npm. Under Yarn Plug'n'Play, oxlint cannot load oxlint-tailwindcss and
  oxlint-tailwindcss-vue exits 2 ("oxlint was not found in the project").

## Requirements

- Node 22.12.0 or newer.
- oxlint 1.94.0 or newer: it is the first version whose `--print-config` keeps
  the settings of JS plugins and the options of their rules (oxc#29534,
  #29533, #29530). Older versions lose `entryPoint`.
- oxlint-tailwindcss 1.17.2 or newer, the version the tests run.
- Tailwind CSS 4.1.15 or newer, as oxlint-tailwindcss requires.

## Decisions after the builder review

- Minimum versions as above, instead of a config reader of our own for older
  oxlint versions.
- Disable comments in templates are supported in 0.1 (contract rule 7): a
  linter needs an inline way out.
- Column units are fixed per format (see "Output").
- `--fix` comes in 0.2, after 0.1 has proven the positions on real projects.
- Nuxt: `.vue` files work the same way; a Nuxt fixture confirms it before the
  `nuxt` keyword is added.

## Known limitations of 0.1

- `enforce-consistent-line-wrapping` with `"wrapLines": "all"` reports some
  multi-line class values that are wrapped as it asks. The rule reads the base
  indent from the leading whitespace of the line where the value starts, and
  in the virtual file the blanked tag and attribute name count as indentation
  up to the callee. Writing `;` on the first character of an attribute that
  starts its own line would keep the indent, but an attribute on the tag line
  cannot be fixed that way without bending the contract. A value on one line
  within the print width is never reported, and `"wrapLines": "overWidth"`
  (for example in an override for `**/*.vue`) avoids the false reports. An
  integration test named as a known limitation pins the current reports, so a
  fix shows up as a test change.
- `--debug` lists unquoted keys only for an object at the top of `:class` or
  directly inside an array there. Deeper objects (ternary branches, `&&` and
  `||` operands, nested arrays, calls such as `cn({ active: x })`) are not
  listed, and their unquoted keys are not checked either.
- In an object of an attribute from settings, keys named `variants`,
  `compoundVariants` and `defaultVariants` get the cva reading instead of the
  JSX one: the value of `defaultVariants` is not read, and the classes a
  `cva()` config holds under `variants` and `compoundVariants` are. An
  integration test pins it.

## Open question

The plugin cannot judge two kinds of template code through a function call,
and 0.1 has to choose between documenting them and working around them:

1. `no-dark-without-light`, `no-contradicting-variants` and
   `no-borrowed-component-styles` only judge the class list of a JSX element.
   Running them would need JSX wrappers around native elements (a `.tsx`
   virtual file, more room around each attribute) and Vue rules for when a
   static `class` is an element's final class list (not with a `:class` on the
   same element, nor on a component root that inherits classes).
2. The plugin reads only quoted object keys, so `:class="{ active: isActive }"`
   is rewritten but its key is never checked. Checking unquoted keys would
   need a second virtual pass where each key is its own literal at its offset.

Recommendation: document both in 0.1 (README Limitations, and a `--debug`
note for unquoted keys), and work on them after 0.1. 0.1 follows it: both are
in the README Limitations, and `--debug` prints an `unquoted-key` notice.
