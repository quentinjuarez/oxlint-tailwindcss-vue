# oxlint-tailwindcss-vue

A CLI that lints the Tailwind CSS classes of Vue SFC templates with the user's
own oxlint and oxlint-tailwindcss. oxlint passes only `<script>` blocks to JS
plugins, so this package builds offset-preserving virtual files of the
templates and runs oxlint on them. The design is in docs/design.md.

## Commands

Node 26.13.1 (`.nvmrc`). Yarn 3.8.6 is committed in `.yarn/releases`, so no
corepack is needed.

```sh
yarn install
yarn verify          # lint, format check, typecheck, tests with coverage, build, publint
yarn test            # Vitest
yarn test:coverage   # thresholds: 95% statements, functions and lines, 90% branches
yarn format          # oxfmt, also sorts package.json
```

## Layout

- `src/cli.ts`: the bin (shebang) and its signal handlers.
- `src/cli/args.ts`: argument parsing. `src/cli/main.ts`: help, version,
  output, error messages and the exit code, which `exitCodeFor` in
  `src/output/format.ts` decides.
- `src/index.ts`: the public API (`virtualize`, `lint`) and its types.
- `test/`: Vitest. `test/fixtures/` holds byte-exact `.vue` fixtures; the ones
  in `test/fixtures/crlf/` keep their CRLF line endings (`.gitattributes`).
- `scripts/`: release helpers run by CI, tested in `test/release-scripts.test.ts`.
- `docs/design.md`: the design. Update it in the same commit when a decision
  changes.

## Rules

- English everywhere: code, comments, docs and commit messages.
- Code speaks for itself. A comment only states an invariant the code cannot
  show (offset arithmetic, an oxlint quirk) and points to its evidence.
- No em dashes, no `--` as punctuation, no ellipses, no emojis, no curly quotes.
- Tests first. A bug or a new Vue construct gets a fixture and a failing test
  before the fix.
- Never bend the virtual file contract to make a case pass: skip the attribute
  with a reason instead. Load the `virtual-file-contract` skill before touching
  the virtualizer, the position mapping or the style-class reader.
- README, npm description and keywords follow the `readme` skill.
- A change to the public API is a semver change: pick the commit type for it.

## Git and releases

- This is a public npm package: every push to `main` can publish. Work on a
  `<type>/<slug>` branch, test locally, squash into one Conventional Commit,
  and open a pull request only after Quentin approves its description. No
  trailers.
- Never cite a personal or private project anywhere in this repository:
  README, docs, tests, fixtures, commits.
- Conventional Commits decide releases: `feat` gives a minor, `fix` and `perf`
  a patch, `!` or a `BREAKING CHANGE` footer a major, anything else nothing.
  Use `chore`, `docs`, `test`, `ci` or `refactor` for work that must not
  release.
- CI releases from the `release` job, the only one with `id-token: write`: it
  publishes with npm trusted publishing (OIDC) and provenance, then commits
  `release: vX.Y.Z`, tags it and creates the GitHub release. It runs none of
  the dev tools, and only while the repository variable `RELEASE_ENABLED` is
  `true`. Run the workflow by hand only to retry a failed release.

## Specialized agents (`.claude/agents/`)

- `contract-reviewer`: after any change to the virtualizer, the position
  mapping or the style-class reader.
- `vue-edge-case-hunter`: before a release, after a `@vue/compiler-sfc` bump,
  or when someone reports a wrong position.
- `readme-reviewer`: after any change to README.md, the npm description or the
  keywords.
- `release-reviewer`: when package.json, the exports, the bin or CI change.
