---
name: readme
description: Use when writing or changing README.md, the package.json description or keywords, the GitHub About text or topics, or any text meant to answer "how do I lint Tailwind classes in Vue templates with oxlint".
---

# README for people and for AI answer engines

The README is the page ChatGPT, Claude, Perplexity and Google AI Overviews
retrieve and quote when a developer asks why oxlint-tailwindcss misses Vue
template classes. It must give the answer in its first lines, use the exact
words people search, and stay true. GitHub serves it to AI crawlers; npm,
jsDelivr and unpkg keep a copy of every published version, so it must be right
before each publish.

## Rules

1. **First sentence names the package as its subject** and the five search
   words: oxlint, oxlint-tailwindcss, Vue, template, Tailwind CSS. Write
   "oxlint-tailwindcss-vue is a CLI that", never "This CLI" or "It".
2. **Every section stands alone**: repeat "oxlint-tailwindcss-vue" instead of
   "it", because AI tools quote sections out of context.
3. **Show real output as text** right after the opening: a five-line `.vue`
   snippet with two bad classes, then the terminal output copied from a real
   run (path, line, column, rule id, message). Never invent output, never use a
   screenshot.
4. **Quote primary sources verbatim, with links**: the oxc compatibility page
   ("No template linting yet"), the oxlint-tailwindcss frameworks page
   ("Classes written in a template are not checked yet"), oxc#21936. Fetch each
   quote again before a release: these pages change.
5. **Numbers carry a date, the versions and the machine**, and never sit in
   the first sentence.
6. **Headings**: one H2 phrased as the real question, "Why doesn't
   oxlint-tailwindcss check classes in Vue templates?"; FAQ entries as H3
   questions answered in one or two sentences that start with the fact; every
   other heading phrased as a task ("Run it in CI and in a pre-commit hook").
7. **Alternatives table with documented facts only**: write "documented" or
   "not documented", with a link, never a guess. Rows: oxlint-tailwindcss alone,
   eslint-plugin-better-tailwindcss, tw-lint, oxlint-vue, Vize, oxfmt
   `sortTailwindcss` and prettier-plugin-tailwindcss (sorting only).
8. **State the limits** in a Limitations section: what is not checked, no
   editor diagnostics, no fixes (until they ship), runtime-built classes.
9. **Every command, flag and option in the README exists in `--help`**, and
   every claim matches the code. Run the commands before writing them.
10. **First screen**: no logo, no badge wall (two badges at most, after the
    opening paragraph), no sponsor box. Never hide install steps or FAQ answers
    in `<details>` or images.
11. **Plain English**: short sentences, no marketing words, no em dashes, no
    emojis, no curly quotes.
12. **npm description**: under 150 characters, no angle brackets (write
    "Vue templates", not `<template>`), same sentence as the GitHub About.
13. **No llms.txt and no keyword stuffing**: neither has a measured effect.
    Keywords: cli, lint, linter, oxc, oxlint, oxlint-tailwindcss, tailwind,
    tailwindcss, tailwindcss-v4, template, vue, vue-sfc, vue3 (add nuxt only
    after a Nuxt fixture passes). Never `oxlint-plugin`: this is not a plugin.
14. **Never claim untested support** (Svelte, Astro, Vue 2, Tailwind v3, Pug).
15. **Copy technical facts from `docs/design.md` and the code, never from
    memory or from a summary.** For example, positions are exact because the
    virtual file keeps the UTF-16 offsets and oxlint's byte offsets are mapped
    back through them, not because "nothing is mapped back".

## Outline

1. `# oxlint-tailwindcss-vue`
2. Opening paragraph, no heading (rule 1).
3. Example: snippet and real output (rule 3).
4. `## Quick start`: install with npm, pnpm and yarn; the `package.json`
   script `oxlint && oxlint-tailwindcss-vue`; where the CSS entry point is set.
5. `## Why doesn't oxlint-tailwindcss check classes in Vue templates?`: three
   to five lines with the quotes and links of rule 4, and the fact that oxlint
   exits clean, so the gap is silent.
6. `## What oxlint-tailwindcss-vue checks`: a table of attribute forms, a table
   of findings with their rule ids, and what is not checked.
7. `## How oxlint-tailwindcss-vue works`: the four steps, and why positions
   are exact (rule 15).
8. `## Results on a real Vue app`: dated numbers with versions (rule 5).
9. `## Options`: flags, config lookup, exit codes.
10. `## Run it in CI and in a pre-commit hook`.
11. `## Requirements`: Node range, oxlint and oxlint-tailwindcss minimums,
    Tailwind CSS 4.1.15 or newer, Vue 3 single-file components.
12. `## Limitations`.
13. `## FAQ`.
14. `## Alternatives and related tools`.
15. `## License`.

## Red flags

| Thought                                              | Reality                                                                          |
| :--------------------------------------------------- | :------------------------------------------------------------------------------- |
| "A short tagline reads better than the package name" | the first sentence is what gets quoted: it must name the package and the problem |
| "I'll paraphrase the oxc page"                       | exact quotes are what keyword search and AI retrieval match                      |
| "The output looks like this"                         | only a copied real run is allowed                                                |
| "It also works with Svelte, probably"                | untested support is a false claim that AI tools will repeat                      |
