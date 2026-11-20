# oxlint-tailwindcss-vue

oxlint-tailwindcss-vue is a CLI that runs oxlint-tailwindcss on the Tailwind
CSS classes in Vue templates, without ESLint. Oxlint only passes the `<script>`
blocks of `.vue` files to JS plugins, so on its own oxlint-tailwindcss never
sees `class` or `:class` in a template, and a typo there passes the lint.

oxlint-tailwindcss-vue is in development and not published on npm yet. The
design is in [docs/design.md](docs/design.md).

## License

[MIT](LICENSE)
