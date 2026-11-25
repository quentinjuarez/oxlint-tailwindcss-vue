import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolError } from '../../src/errors.js';
import { copyBack } from '../../src/fix/copy-back.js';
import { lint, type LintResult } from '../../src/lint.js';
import { project, removeScratchDirs } from '../helpers/project.js';

vi.mock('../../src/fix/copy-back.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/fix/copy-back.js')>();
  return {
    ...actual,
    copyBack: vi.fn<typeof actual.copyBack>(actual.copyBack),
  };
});

const TIMEOUT = 60_000;
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const fixPlugin = readFileSync(join(fixtures, 'fix-plugin/index.mjs'), 'utf8');
const style = '@import "tailwindcss";\n';
const bugsUrl = (
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { bugs: string }
).bugs;

afterEach(removeScratchDirs);

function config(rules: Record<string, unknown>): string {
  return JSON.stringify({
    jsPlugins: ['oxlint-tailwindcss'],
    settings: { tailwindcss: { entryPoint: 'src/style.css' } },
    rules,
  });
}

function vendorProject(rules: Record<string, unknown>, vue: string): string {
  return project({
    '.oxlintrc.json': JSON.stringify({
      jsPlugins: ['./oxlint-tailwindcss/index.mjs'],
      rules,
    }),
    'oxlint-tailwindcss/index.mjs': fixPlugin,
    'src/App.vue': vue,
  });
}

function remaining(result: LintResult) {
  return result.findings.map(({ rule, start }) => ({
    rule,
    line: start.line,
    column: start.column,
  }));
}

const read = (cwd: string, file = 'src/App.vue') =>
  readFileSync(join(cwd, file), 'utf8');
const vendorVue = '<template>\n  <p class="p-2">x</p>\n</template>\n';

describe('lint with fix', () => {
  it(
    'fixes static values, bound strings and template literals, then reports what remains',
    async () => {
      const vue = [
        '<template>',
        '  <div class="p-4 flex flex">',
        `    <p :class="['mt-2 mb-2', ok && 'px-2 py-2']">a</p>`,
        '    <span :class="`text-red-500 text-red-500 ${size}`">b</span>',
        '    <i class="text-grey-500 p-4 flex">c</i>',
        '  </div>',
        '</template>',
        '',
      ].join('\n');
      const cwd = project({
        '.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
          'tailwindcss/enforce-sort-order': 'warn',
          'tailwindcss/enforce-shorthand': 'warn',
          'tailwindcss/no-unknown-classes': 'error',
        }),
        'src/style.css': style,
        'src/App.vue': vue,
      });
      await lint({ cwd });
      expect(read(cwd)).toBe(vue);
      const result = await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(
        [
          '<template>',
          '  <div class="flex p-4">',
          `    <p :class="['my-2', ok && 'p-2']">a</p>`,
          '    <span :class="`text-red-500 ${size}`">b</span>',
          '    <i class="text-grey-500 flex p-4">c</i>',
          '  </div>',
          '</template>',
          '',
        ].join('\n'),
      );
      expect(remaining(result)).toEqual([
        { rule: 'tailwindcss/no-unknown-classes', line: 5, column: 14 },
      ]);
      expect(result.files[0]?.fixed).toBe(true);
      expect(result.files[0]?.refusedFixes).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    'keeps the byte order mark and the CRLF line endings, and changes only the value',
    async () => {
      const vue =
        '\u{feff}<template>\r\n  <p\r\n    class="mt-2\r\n      mb-2 mt-2"\r\n  >x</p>\r\n</template>\r\n';
      const cwd = project({
        '.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'src/style.css': style,
        'src/App.vue': vue,
      });
      const result = await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(vue.replace('mb-2 mt-2"', 'mb-2"'));
      expect(result.findings).toEqual([]);
      expect(result.files[0]?.fixed).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'refuses to fix a value with a space before a CRLF, and keeps that space',
    async () => {
      const vue =
        '<template>\r\n  <p\r\n    class="mt-2 \r\n      mb-2 p-2 p-2"\r\n  >x</p>\r\n</template>\r\n';
      const cwd = project({
        '.oxlintrc.json': config({
          'tailwindcss/no-unnecessary-whitespace': 'warn',
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'src/style.css': style,
        'src/App.vue': vue,
      });
      const result = await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(vue);
      expect(result.files[0]?.fixed).toBeUndefined();
      expect(result.files[0]?.refusedFixes).toEqual([
        { code: 'line-break', line: 3, column: 5 },
      ]);
      expect(remaining(result)).toEqual([
        { rule: 'tailwindcss/no-duplicate-classes', line: 3, column: 11 },
      ]);
    },
    TIMEOUT,
  );

  it(
    'does not apply enforce-consistent-line-wrapping, and reports its findings',
    async () => {
      const source = join(fixtures, 'projects/line-wrapping');
      const vue = readFileSync(join(source, 'src/A.vue'), 'utf8');
      const cwd = project({
        '.oxlintrc.json': readFileSync(join(source, '.oxlintrc.json'), 'utf8'),
        'src/style.css': readFileSync(join(source, 'src/style.css'), 'utf8'),
        'src/A.vue': vue,
      });
      const result = await lint({ cwd, fix: true });
      expect(read(cwd, 'src/A.vue')).toBe(vue);
      expect(remaining(result)).toEqual(
        [
          [3, 11],
          [8, 13],
          [12, 12],
        ].map(([line, column]) => ({
          rule: 'tailwindcss/enforce-consistent-line-wrapping',
          line,
          column,
        })),
      );
      expect(result.files[0]?.fixed).toBeUndefined();
      expect(result.files[0]?.refusedFixes).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    'respects disable comments in templates',
    async () => {
      const vue = [
        '<template>',
        '  <!-- oxlint-disable-next-line tailwindcss/no-duplicate-classes -->',
        '  <p class="p-2 p-2">kept</p>',
        '  <p class="m-2 m-2">fixed</p>',
        '</template>',
        '',
      ].join('\n');
      const cwd = project({
        '.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'src/style.css': style,
        'src/App.vue': vue,
      });
      const result = await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(vue.replace('m-2 m-2', 'm-2'));
      expect(result.findings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'fixes a file next to one without a template, and leaves that one as it is',
    async () => {
      const script = '<script setup lang="ts">\nconst n = 1;\n</script>\n';
      const cwd = project({
        '.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'src/style.css': style,
        'src/App.vue': '<template>\n  <p class="p-2 p-2">x</p>\n</template>\n',
        'src/Script.vue': script,
      });
      await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(
        '<template>\n  <p class="p-2">x</p>\n</template>\n',
      );
      expect(read(cwd, 'src/Script.vue')).toBe(script);
    },
    TIMEOUT,
  );

  it(
    'fixes each config group with its own rules',
    async () => {
      const cwd = project({
        'packages/a/.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'packages/a/src/style.css': style,
        'packages/a/src/App.vue':
          '<template>\n  <p class="p-2 p-2">a</p>\n</template>\n',
        'packages/b/.oxlintrc.json': JSON.stringify({ rules: {} }),
        'packages/b/src/App.vue':
          '<template>\n  <p class="p-2 p-2">b</p>\n</template>\n',
      });
      const result = await lint({ cwd, fix: true });
      expect(read(cwd, 'packages/a/src/App.vue')).toBe(
        '<template>\n  <p class="p-2">a</p>\n</template>\n',
      );
      expect(read(cwd, 'packages/b/src/App.vue')).toBe(
        '<template>\n  <p class="p-2 p-2">b</p>\n</template>\n',
      );
      expect(result.skippedConfigs).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'writes nothing when a later config group fails',
    async () => {
      const vue = '<template>\n  <p class="p-2 p-2">a</p>\n</template>\n';
      const cwd = project({
        'packages/a/.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'packages/a/src/style.css': style,
        'packages/a/src/App.vue': vue,
        'packages/b/.oxlintrc.json': JSON.stringify({
          jsPlugins: ['oxlint-tailwindcss'],
          settings: { tailwindcss: { entryPoint: 'src/missing.css' } },
          rules: { 'tailwindcss/no-duplicate-classes': 'error' },
        }),
        'packages/b/src/App.vue':
          '<template>\n  <p class="m-2 m-2">b</p>\n</template>\n',
      });
      vi.mocked(copyBack).mockClear();
      const error = await lint({ cwd, fix: true }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ToolError);
      expect((error as ToolError).message).toContain('src/missing.css');
      expect(
        vi.mocked(copyBack).mock.calls.map(([{ source }]) => source),
      ).toEqual([vue]);
      expect(read(cwd, 'packages/a/src/App.vue')).toBe(vue);
    },
    TIMEOUT,
  );

  it(
    'stops after 10 passes and keeps the last state',
    async () => {
      const cwd = vendorProject(
        { 'tailwindcss/count': 'error' },
        '<template>\n  <p class="p-1">x</p>\n</template>\n',
      );
      const result = await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(
        '<template>\n  <p class="p-11">x</p>\n</template>\n',
      );
      expect(remaining(result)).toEqual([
        { rule: 'tailwindcss/count', line: 2, column: 12 },
      ]);
      expect(result.oxlintStderr).toBe('[fix-plugin] loaded');
    },
    TIMEOUT,
  );

  it(
    'refuses a fix that would bring the quote of its attribute',
    async () => {
      const cwd = vendorProject({ 'tailwindcss/quote': 'error' }, vendorVue);
      const result = await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(vendorVue);
      expect(result.files[0]?.refusedFixes).toEqual([
        { code: 'unsafe-value', line: 2, column: 6 },
      ]);
      expect(result.files[0]?.fixed).toBeUndefined();
      expect(remaining(result)).toEqual([
        { rule: 'tailwindcss/quote', line: 2, column: 12 },
      ]);
    },
    TIMEOUT,
  );

  it(
    'refuses a fix that changes the code around a value',
    async () => {
      const cwd = vendorProject({ 'tailwindcss/wrap': 'error' }, vendorVue);
      const result = await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(vendorVue);
      expect(result.files[0]?.refusedFixes).toEqual([
        { code: 'skeleton-changed', line: 2, column: 6 },
      ]);
    },
    TIMEOUT,
  );

  it(
    'writes nothing to a file that changed during the run',
    async () => {
      const edited = '<template>\n  <p class="p-2">edited</p>\n</template>\n';
      const cwd = vendorProject({}, vendorVue);
      const file = join(cwd, 'src/App.vue');
      writeFileSync(
        join(cwd, '.oxlintrc.json'),
        JSON.stringify({
          jsPlugins: ['./oxlint-tailwindcss/index.mjs'],
          rules: {
            'tailwindcss/touch': [
              'error',
              { file, from: vendorVue, text: edited },
            ],
          },
        }),
      );
      const result = await lint({ cwd, fix: true });
      expect(read(cwd)).toBe(edited);
      expect(result.files[0]?.refusedFixes).toEqual([
        { code: 'changed-on-disk', line: 1, column: 1 },
      ]);
      expect(result.files[0]?.fixed).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    'writes nothing to a file that is not valid UTF-8',
    async () => {
      const bytes = Buffer.from(
        '<template>\n  <!-- Résumé -->\n  <p class="p-2 p-2">x</p>\n</template>\n',
        'latin1',
      );
      const cwd = project({
        '.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'src/style.css': style,
      });
      const file = join(cwd, 'src/App.vue');
      writeFileSync(file, bytes);
      const result = await lint({ cwd, fix: true });
      expect(readFileSync(file).equals(bytes)).toBe(true);
      expect(result.files[0]?.refusedFixes).toEqual([
        { code: 'changed-on-disk', line: 1, column: 1 },
      ]);
      expect(result.files[0]?.fixed).toBeUndefined();
    },
    TIMEOUT,
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'rejects with a ToolError naming a fixed file it may not write',
    async () => {
      const cwd = project({
        '.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'src/style.css': style,
        'src/App.vue': '<template>\n  <p class="p-2 p-2">x</p>\n</template>\n',
      });
      const file = join(cwd, 'src/App.vue');
      chmodSync(file, 0o444);
      try {
        const error = await lint({ cwd, fix: true }).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(ToolError);
        expect((error as ToolError).message).toContain(file);
        expect((error as ToolError).message).toContain('EACCES');
      } finally {
        chmodSync(file, 0o644);
      }
    },
    TIMEOUT,
  );

  it(
    'names the .vue file and asks for a bug report when copying back throws',
    async () => {
      const vue = '<template>\n  <p class="p-2 p-2">x</p>\n</template>\n';
      const cwd = project({
        '.oxlintrc.json': config({
          'tailwindcss/no-duplicate-classes': 'error',
        }),
        'src/style.css': style,
        'src/App.vue': vue,
      });
      const slip = new Error('internal slip');
      vi.mocked(copyBack).mockImplementationOnce(() => {
        throw slip;
      });
      const error = await lint({ cwd, fix: true }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ToolError);
      const { message, hint, cause } = error as ToolError;
      expect(message).toContain(join(cwd, 'src', 'App.vue'));
      expect(message).toContain('internal slip');
      expect(hint).toContain('bug in oxlint-tailwindcss-vue');
      expect(hint).toContain(bugsUrl);
      expect(cause).toBe(slip);
      expect(read(cwd)).toBe(vue);
    },
    TIMEOUT,
  );
});
