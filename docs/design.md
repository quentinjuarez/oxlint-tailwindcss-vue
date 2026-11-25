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
- No `--fix` in 0.1 (shipped in 0.4, see "Fixes (0.4)").
- No Svelte, Astro, Vue 2 or Pug templates.
- No merged report with the native oxlint run: users chain
  `oxlint && oxlint-tailwindcss-vue`.

## Anti-goals

- A wrong line or column. It is worse than no report.
- A report that also comes from the native oxlint run.
- False reports on classes the component defines in its own `<style>`.
- Writing to the user's project, except the class values that `--fix`
  changes.

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
   user's `-c`) and flatten it with `oxlint --print-config`. The root config
   (the `-c` file, or the config found from the cwd) is flattened too: oxlint
   accepts `options` only there, and applies them to every file.
3. **Virtualize.** Parse each file with `@vue/compiler-sfc` and build a virtual
   `.ts` file (see "Virtual file contract").
4. **Derive a config** per config group: the files that share an oxlint config
   (see "Derived config").
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
   (`--fix` writes `\r\n` as ` \n`, because the plugin sizes fix ranges on the
   LF-normalized raw value: see "Fix mode of the virtual file". Reports do not
   depend on it.) A value with a backtick or `${` keeps its original quotes
   when it fits on one line without a backslash; otherwise it is skipped.
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
   `Transition`, `TransitionGroup`, `RouterLink` and `NuxtLink`, and every
   attribute listed in the user's oxlint-tailwindcss `attributes` or
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
  the same alias count as one (a bare `"oxlint-tailwindcss"` entry has the
  plugin's own name, `tailwindcss`), different aliases are a tool failure.
- `settings.tailwindcss`: the user's block, with `entryPoint` made absolute,
  `__` added to `callees` and `___: 'cva'` added to the user's
  `calleeExtractors` (oxlint-tailwindcss also registers every extractor name
  as a callee).
- `rules`: only the `tailwindcss/*` rules (or the user's alias), with option
  paths made absolute.
- `overrides`: the user's overrides reduced to the Tailwind rules, with their
  `files` and `excludeFiles`. No per-file allowlist override is written: it
  would be replaced by any user override of `no-unknown-classes` (see "Classes
  defined in `<style>`").
- Every user glob, in override `files` and `excludeFiles` and in `entryPoint`
  mapping `files`, gets `.ts` appended, or `/*.ts` after a final `**` or `/`
  (oxlint does not recurse on `**.ts`). Only virtual files are linted, and the
  suffix keeps exactly the `.vue` files the glob matched: `**/*.ts` stays away
  from templates, `**/*.{js,vue}` and `src/legacy/**` reach them.
- `options.respectEslintDisableDirectives` of the root config, when it is set,
  so `eslint-disable` comments in templates follow it as they do in scripts.
  No other option is copied: the CLI applies `maxWarnings` and `denyWarnings`
  itself (see "Running oxlint").

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
  child: the CLI applies them itself on the mapped results, with
  `options.maxWarnings` and `options.denyWarnings` of the root config when the
  matching flag is absent. A flag wins, as in oxlint: `--max-warnings` replaces
  `maxWarnings`, and `denyWarnings: true` still applies with it.
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
findings are counted. A wildcard `@utility fancy-*` keeps its `*`, which
marks a prefix: it drops the findings whose quoted class starts with
`fancy-`, while a class literally named `.fancy-` stays an exact name. An
integration test pins the plugin's message format.

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
- stderr, in every format: what oxlint and its JS plugins print while linting
  the virtual files (oxlint-tailwindcss warns there when the Tailwind CSS
  engine is newer than the one it was tested with), each line once across
  oxlint runs. With `json` and `github`, the `--debug` notes go there too, so
  stdout holds only the report.

## Exit codes

| Code     | Meaning                                                                                                                                                                                                      |
| :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0        | No error, and warnings within `--max-warnings` (or the root config's `options.maxWarnings`)                                                                                                                  |
| 1        | At least one error, a virtual file oxlint could not parse, or warnings over the limit                                                                                                                        |
| 2        | Tool failure: oxlint not found, no config group loads oxlint-tailwindcss, a listed file that cannot be read, a fixed file that cannot be written, missing CSS entry point, unexpected oxlint output or crash |
| 130, 143 | Interrupted by SIGINT or SIGTERM                                                                                                                                                                             |

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
      --fix                 apply the fixes of the Tailwind rules to the
                            .vue files, then report what remains
      --debug               list skipped attributes and refused fixes with
                            their reason (on stderr with json and github),
                            and print the stack of an unexpected error
  -h, --help                show this help
  -V, --version             show the version
```

An unexpected error while reading one `.vue` file (the virtualizer, the
style reader or the copy-back of fixes) is a tool failure that names the file
and asks for a bug report at the issues URL of `package.json`; the error is
kept as its `cause`, and `--debug` prints its stack.

## Programmatic API

- `virtualize(source, options)` returns the virtual code, the rewritten regions
  and the skipped attributes with their reason.
- `lint(options)` runs the whole pipeline and returns the mapped diagnostics,
  with `warningOptions`: the `denyWarnings` and `maxWarnings` of the root
  config's `options`, which the CLI applies, and `oxlintStderr` when oxlint or
  its JS plugins printed anything on stderr, which the CLI prints. With
  `fix: true` it applies the fixes first, and a `FileReport` gets `fixed` and
  `refusedFixes` (see "Reporting").
- `ToolError` is the error `lint()` rejects with for a tool failure, with a
  `message` and an optional `hint`.

## Temp files and signals

- The temp root is `realpath(mkdtemp(realpath(os.tmpdir())/oxlint-tailwindcss-vue-))`.
- It is removed in `finally` and on SIGINT, SIGTERM, SIGHUP and SIGBREAK, after
  the child has exited (Windows refuses to delete files still open).
- Stale temp roots older than a day are pruned at start. A temp root holds a
  marker file, and only folders with the prefix and the marker are pruned.
- The plugin's own cache in the temp dir is never touched (its folder,
  `oxlint-tailwindcss-<user>`, can share the prefix on Windows).

## Fixes (0.4)

`--fix` (and `lint({ fix: true })`) applies the fixes of the Tailwind rules
enabled in the user's config to the `.vue` files, then lints them again and
reports what remains. A linter that fixes is easier to adopt: 15 of the 27
rules of oxlint-tailwindcss 1.17.2 can fix code (canonical classes, sort order,
duplicates, shorthands and more).

Fixes change lengths and line counts, so they cannot be copied back by offset.
The strategy, validated with the rest of this design: let oxlint fix the
virtual files, compare their tokens before and after, and copy back only the
string contents that changed, where that is exact and safe.

Goals:

- The fixes oxlint would apply to a script block, with the user's rules, rule
  options, overrides and disable comments.
- Never a wrong character in a `.vue` file: a fix that cannot be copied back
  exactly is refused, and its finding stays in the report.

Non-goals: `--fix-suggestions` and `--fix-dangerously`; a summary of applied
fixes (oxlint prints none); fixing an attribute the virtualizer skips.

Anti-goals:

- A silently wrong class. Without the fix mode below, oxlint turns
  `mt-2\r\n      mb-2 mt-2` into `mt-2\n      mb-22`: the plugin sizes its
  fix on the LF-normalized raw value of the template literal, so the range
  lands one character early, and `mb-22` is a valid class that no rule reports.
- A change outside a class value: markup, scripts, styles and the line endings
  of the file stay as they are.
- Writing a file that changed after it was read.

### Pipeline

1. Select the files and read the configs as in a normal run.
2. Per config group, write the virtual files in fix mode and the derived
   config to the temp root, without `enforce-consistent-line-wrapping` in its
   `rules` and in the `rules` of its overrides (see "Line wrapping").
3. Run `oxlint -c <derived config> --fix --format json -A all
   --no-error-on-unmatched-pattern <virtual paths>` until no virtual file
   changes, at most 10 passes: one pass applies only the fixes that do not
   overlap (3 passes on a component with duplicates, a shorthand and an
   unsorted list), and 10 is ESLint's cap. At the cap, the last state is used;
   two rules that undo each other (`enforce-logical` and `enforce-physical`)
   end there. A pass after the first runs only the virtual files that the
   previous pass changed. What the passes print on stderr joins `oxlintStderr`.
4. Per `.vue` file whose virtual file changed: compare and copy back. Every
   config group is fixed before any file is written, so a tool failure during the
   fix passes writes nothing. Then check each file on disk and write it.
5. Run the normal pipeline on the files as written. The findings, the
   `--debug` notes and the exit code describe what remains.

### Fix mode of the virtual file

The contract holds, with one difference: inside a template literal, static
value or bound expression, `\r\n` is written as ` \n`. A template literal's
raw value counts `\r\n` as one character, so the plugin's fix ranges would
land one character early per earlier `\r\n`; ` \n` keeps both counts equal.
A template literal with a lone `\r` is not fixed (`line-break`). The report
run keeps the contract as it is.

One rewrite of the report run is lost in fix mode: a bound JS string with a
backslash line continuation before a CRLF (`:class="'p-2 \<CRLF>  m-2'"`).
With the `\r` written as a space, the backslash escapes that space instead of
the line break, so the string holds a raw line feed and the virtual file does
not parse. The safety net skips that attribute in fix mode only
(`parse-safety-net`): it is not fixed, and its findings stay in the report.
A fix that keeps the backslash would be refused anyway, since a new text with a
backslash is refused (`unsafe-value`).

### Line wrapping

`enforce-consistent-line-wrapping` is the only fixable rule whose fix reads
text outside the class string: it rebuilds the value as a block indented from
the leading whitespace of the line where the value starts. In the virtual
file, that whitespace counts the blanked tag and attribute name, is always
spaces, and every static value is a template literal, which the rule wraps
even with `wrapStrings: "never"`. Copied back, its fixes would write wrong
indents, spaces in tab-indented files and LF breaks in CRLF files. The fix
passes run without the rule, and its findings stay in the report (a README
limitation). As a safety net, a replacement whose new text has more line
breaks than the original, or any carriage return, is refused (`line-break`).
Fixing it with the attribute's real indentation and line ending is later work.

### Comparing and copying back

- Both virtual files are tokenized with `@babel/parser` (`typescript`, as in
  the safety net). Babel 8 template tokens hold their delimiters (`` ...` ``
  and `...${`), so a value's content is `[start + 1, end - 1]`, or
  `[start + 1, end - 2]` for `...${`. A fixed file that does not parse
  refuses every fix of its `.vue` file (`parse-error`).
- Each rewrite is a region of tokens that starts with `;`, the callee (`__` or
  `___`) and `(`, and ends at the matching `)`; outside the regions there are
  only blanks and disable comments. The regions of both files are paired in
  order. A different count refuses every fix of the file (`regions-changed`).
- In a pair, the skeleton (the label of every token, and the raw text of every
  token that is not a string or template part, numbers and regular
  expressions included) must be equal, or the region is refused
  (`skeleton-changed`). A changed string or template part becomes a
  replacement: the original token's span is the same span in the `.vue` file,
  and the `.vue` text there must equal the original token text once ` \n` is
  decoded, or the region is refused (`source-mismatch`).
- Decoding: in a value whose original raw text had `\r\n`, every `\n` of the
  new text becomes `\r\n`, and the one space just before it, when there is
  one, is dropped (it was the placeholder). That space is the placeholder
  only when the original has no blank before that CRLF. A changed value whose
  original has a space or a tab before a CRLF is refused (`line-break`): a fix
  such as `no-unnecessary-whitespace` may merge the placeholder with the real
  blank, and the two can no longer be told apart.
- The new text is refused (`unsafe-value`) when it holds the quote character
  of its attribute, a backslash, a backtick or `${`, `&` followed by a letter
  or `#`, with or without `;` (an HTML character reference, or something Vue
  may read as one), or a control character: U+0000 to U+001F other than tab,
  line feed and carriage return, or U+007F (DEL). The rule for a value without
  quotes applies to bound values too: it also refuses whitespace, a quote,
  `=`, `<`, `>` and an empty new text, since `<p class=  id=x>` would make Vue
  read `id=x` as the class value. A quoted value may become empty
  (`class=""`).
- A changed value that mixes CRLF with LF, holds a lone CR, or has a space or
  a tab before a CRLF is refused (`line-break`), as is a replacement with more
  line breaks than the original, or whose new text holds a carriage return
  before decoding.
- A refusal is located at the start of its attribute, in the file as written.
  A file-wide refusal (`parse-error`, `regions-changed`, `changed-on-disk`) is
  located at the file's start.
- A refused region refuses its replacements and no other region's.
  Replacements are applied from the end of the file to the start.

### Writing

- The file is read again as bytes just before writing, and compared with the
  UTF-8 encoding of the text that was virtualized. A file that changed during
  the run, or that is not valid UTF-8 (its bytes do not round-trip), is not
  written: `changed-on-disk`, at line 1, column 1, and it replaces the other
  refusals of that file. A file with a byte order mark is fixed as usual.
- A file that cannot be written (for example a read-only file) makes `lint()`
  reject with a `ToolError` that names the file
  (`Cannot write <file>: <reason>`, with a hint). Files already written stay
  written.
- The file is written in place, as oxlint and ESLint write fixes; the BOM and
  the line endings outside the replaced values stay as they are.

### Reporting

- `lint()` takes `fix?: boolean`. A `FileReport` gets `fixed: true` when its
  file was written, and `refusedFixes`, with a `code` and the line and column
  of the refusal (see "Comparing and copying back") in the file as written.
- `--debug` prints `<path>:<line>:<column> fix refused <code>` with the other
  notes: after the findings in the default format, on stderr with `json` and
  `github`.
- The help and the README document `--fix`. The "No fixes" limitation went,
  and a new one says that `--fix` does not apply
  `enforce-consistent-line-wrapping` in templates.

### Shipped with it

- `ToolError` is exported. The README says what `lint()` rejects with: a
  `ToolError` (a message and an optional `hint`) for a tool failure, the
  signal's reason when it is aborted, and any other error only on a bug.
- `prefetched-class` is checked on `NuxtLink` and `nuxt-link` only, and the
  README no longer lists it as not checked.

### Tests

- The copy-back is a pure function (virtual file before and after, `.vue`
  text, regions) with unit tests for every replacement shape, every refusal
  code, the decoding and the region pairing.
- Integration tests run the real plugin's fixes on fixture projects: static
  values, bound strings and template literals, a CRLF value, a fix that would
  bring a quote into its attribute. Each asserts the written file and the
  remaining findings, on Linux and Windows.
- Vendor plugins with crafted fixes cover what the real plugin does not do: a
  skeleton change, fixes that never converge, a file changed during the run.
- The property test gets a fix mode: the contract holds, and copying back an
  unchanged virtual file writes nothing.

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
- **Acceptance** on a real Vue app before each release.
- Coverage thresholds: 95% statements, functions and lines, 90% branches.

## Acceptance of 0.1

Run read-only from the root of a real Vue 3 and Tailwind CSS 4 app, with
oxlint-tailwindcss-vue 0.1.0:

- Every class attribute checked, none skipped.
- The findings of the spike, at the same lines and columns, in the `default`,
  `json` and `github` formats (exit 1), and no false positive. The
  unknown-class reports of the spike on classes that components define in
  their own `<style>` are removed by the filter on those classes.
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
- `--fix` comes after 0.1 has proven the positions on real projects.
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
