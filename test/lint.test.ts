import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ToolError } from '../src/errors.js';
import * as api from '../src/index.js';
import { lint, type FileReport, type LintResult } from '../src/lint.js';
import {
  mapDiagnostics,
  type MappingContext,
  type VirtualSource,
} from '../src/map-diagnostics.js';
import type { OxlintDiagnostic } from '../src/oxlint/report.js';
import {
  createTempRoot,
  pruneStaleTempRoots,
  type TempRoot,
} from '../src/temp.js';

vi.mock('../src/temp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/temp.js')>();
  return {
    ...actual,
    createTempRoot: vi.fn<typeof actual.createTempRoot>(actual.createTempRoot),
  };
});

const TIMEOUT = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const projects = join(fixtures, 'projects');
const basic = join(projects, 'basic');
const app = join(basic, 'src', 'App.vue');
const broken = join(basic, 'src', 'Broken.vue');
const clean = join(basic, 'src', 'Clean.vue');
const old = join(basic, 'src', 'legacy', 'Old.vue');
const monorepoPackage = join(projects, 'monorepo', 'packages', 'app');
const monorepoApp = join(monorepoPackage, 'src', 'App.vue');
const crlfProject = join(fixtures, 'crlf', 'project');
const crlfApp = join(crlfProject, 'src', 'App.vue');
const nodeModules = fileURLToPath(new URL('../node_modules', import.meta.url));

const crlfFindings = [
  {
    rule: 'tailwindcss/no-unknown-classes',
    severity: 'error',
    line: 2,
    column: 14,
  },
  {
    rule: 'tailwindcss/no-conflicting-classes',
    severity: 'error',
    line: 4,
    column: 13,
  },
  {
    rule: 'tailwindcss/no-unknown-classes',
    severity: 'error',
    line: 9,
    column: 17,
  },
];
const monorepoFindings = [
  {
    rule: 'tailwindcss/no-unknown-classes',
    severity: 'error',
    line: 2,
    column: 12,
  },
];

const vendorPlugin = `export default {
  meta: { name: 'tailwindcss' },
  rules: {
    crash: {
      create: () => ({
        CallExpression() {
          throw new Error('vendor crash');
        },
      }),
    },
    hang: {
      create: () => ({
        CallExpression() {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
        },
      }),
    },
  },
};
`;

const scratch: string[] = [];

beforeEach(() => {
  vi.mocked(createTempRoot).mockClear();
});

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'otv-lint-')));
  scratch.push(dir);
  return dir;
}

function project(files: Record<string, string>): string {
  const dir = scratchDir();
  symlinkSync(nodeModules, join(dir, 'node_modules'), 'junction');
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function vendorProject(rule: 'crash' | 'hang'): string {
  return project({
    '.oxlintrc.json': JSON.stringify({
      jsPlugins: ['./oxlint-tailwindcss/index.mjs'],
      rules: { [`tailwindcss/${rule}`]: 'error' },
    }),
    'oxlint-tailwindcss/index.mjs': vendorPlugin,
    'src/App.vue': '<template>\n  <p class="p-2">vendor</p>\n</template>\n',
  });
}

function overrideProject(files: string[]): string {
  return project({
    '.oxlintrc.json': JSON.stringify({
      jsPlugins: ['oxlint-tailwindcss'],
      settings: { tailwindcss: { entryPoint: 'src/style.css' } },
      rules: { 'tailwindcss/no-unknown-classes': 'error' },
      overrides: [
        { files, rules: { 'tailwindcss/no-unknown-classes': 'off' } },
      ],
    }),
    'src/style.css': '@import "tailwindcss";\n',
    'src/App.vue': '<template>\n  <p class="unknown-app"></p>\n</template>\n',
    'src/legacy/Old.vue':
      '<template>\n  <p class="unknown-old"></p>\n</template>\n',
  });
}

async function reportedFiles(overrideFiles: string[]): Promise<string[]> {
  const dir = overrideProject(overrideFiles);
  const result = await lint({ cwd: dir });
  return result.findings.map(({ file }) =>
    relative(dir, file).split(sep).join('/'),
  );
}

function located(result: LintResult, file: string) {
  return result.findings
    .filter((finding) => finding.file === file)
    .map(({ rule, severity, start }) => ({
      rule,
      severity,
      line: start.line,
      column: start.column,
    }));
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function createdRoots(): string[] {
  return vi
    .mocked(createTempRoot)
    .mock.results.map((result) => (result.value as TempRoot).path);
}

describe('lint on the basic project', () => {
  let result: LintResult;

  beforeAll(async () => {
    result = await lint({ cwd: basic });
  }, TIMEOUT);

  it('reports template findings at their line and column', () => {
    expect(located(result, app)).toEqual([
      {
        rule: 'tailwindcss/no-unknown-classes',
        severity: 'error',
        line: 7,
        column: 14,
      },
      {
        rule: 'tailwindcss/no-duplicate-classes',
        severity: 'error',
        line: 8,
        column: 15,
      },
      {
        rule: 'tailwindcss/no-conflicting-classes',
        severity: 'error',
        line: 9,
        column: 14,
      },
      {
        rule: 'tailwindcss/no-conflicting-classes',
        severity: 'error',
        line: 10,
        column: 23,
      },
      {
        rule: 'tailwindcss/no-unknown-classes',
        severity: 'error',
        line: 14,
        column: 35,
      },
    ]);
  });

  it('ignores classes from the component style block', () => {
    expect(located(result, app).map(({ line }) => line)).not.toContain(11);
    expect(
      result.findings.filter(({ message }) => message.includes('"card"')),
    ).toEqual([]);
  });

  it('honors a disable comment in the template', () => {
    const lines = located(result, app).map(({ line }) => line);
    expect(lines).not.toContain(13);
    expect(lines).toContain(14);
  });

  it('reports UTF-16 columns and byte offsets after non-ASCII text', () => {
    const finding = result.findings.find(
      ({ file, start }) => file === app && start.line === 14,
    );
    expect(finding?.message).toBe(
      '"accent-unknown" is not a valid Tailwind class.',
    );
    expect(finding?.start).toMatchObject({ column: 35, byteColumn: 41 });
    expect(finding?.end).toMatchObject({ line: 14, column: 51 });
    const { offset, byteOffset } = finding?.start ?? {};
    expect((byteOffset ?? 0) - (offset ?? 0)).toBe(6);
  });

  it("applies the user's override severity", () => {
    expect(result.files.map(({ file }) => file)).toContain(old);
    expect(result.findings.filter(({ file }) => file === old)).toEqual([]);
  });

  it('reports a virtual parse error as not checked', () => {
    const report = result.files.find(({ file }) => file === broken);
    expect(report?.notChecked).toBe(
      'Invalid regular expression: Unterminated capturing group',
    );
    expect(result.findings.filter(({ file }) => file === broken)).toEqual([]);
  });

  it('lists one report for every checked file', () => {
    expect(result.files.map(({ file }) => file)).toEqual([
      app,
      broken,
      clean,
      old,
    ]);
    expect(result.files.find(({ file }) => file === clean)).toEqual({
      file: clean,
      skipped: [],
      notices: [],
    });
  });
});

describe('lint on other projects', () => {
  it(
    'reports exact positions in a CRLF component',
    async () => {
      const text = readFileSync(crlfApp, 'utf8');
      expect(text.match(/\r\n/g)).toHaveLength(11);
      expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
      const result = await lint({ cwd: crlfProject });
      expect(located(result, crlfApp)).toEqual(crlfFindings);
    },
    TIMEOUT,
  );

  it(
    'finds the config above the cwd and resolves a relative entryPoint',
    async () => {
      const result = await lint({ cwd: monorepoPackage });
      expect(result.files.map(({ file }) => file)).toEqual([monorepoApp]);
      expect(located(result, monorepoApp)).toEqual(monorepoFindings);
      expect(result.findings[0]?.message).toBe(
        '"unknown-mono" is not a valid Tailwind class.',
      );
    },
    TIMEOUT,
  );

  it(
    'uses the given config and its plugin alias',
    async () => {
      const alias = join(projects, 'alias');
      const result = await lint({ cwd: alias, config: 'alias.oxlintrc.json' });
      expect(located(result, join(alias, 'src', 'App.vue'))).toEqual([
        {
          rule: 'tw/no-duplicate-classes',
          severity: 'warning',
          line: 2,
          column: 14,
        },
        {
          rule: 'tw/no-unknown-classes',
          severity: 'error',
          line: 2,
          column: 14,
        },
      ]);
    },
    TIMEOUT,
  );

  it(
    'lints each config group with its own config',
    async () => {
      const result = await lint({
        cwd: fixtures,
        paths: ['projects/monorepo', 'crlf/project'],
      });
      expect(result.files.map(({ file }) => file)).toEqual([
        crlfApp,
        monorepoApp,
      ]);
      expect(located(result, crlfApp)).toEqual(crlfFindings);
      expect(located(result, monorepoApp)).toEqual(monorepoFindings);
      expect(createTempRoot).toHaveBeenCalledTimes(1);
    },
    TIMEOUT,
  );

  it(
    'checks files outside the folder of the given config',
    async () => {
      const result = await lint({
        cwd: crlfProject,
        config: join(basic, '.oxlintrc.json'),
      });
      expect(located(result, crlfApp)).toEqual(crlfFindings);
    },
    TIMEOUT,
  );

  it(
    'passes the selection to oxlint and checks each file once',
    async () => {
      const ignorePath = join(scratchDir(), 'ignore');
      writeFileSync(ignorePath, 'Clean.vue\n');
      const result = await lint({
        cwd: basic,
        paths: ['src', 'src/App.vue'],
        ignorePath,
        ignorePatterns: ['src/legacy/**'],
        noIgnore: false,
      });
      expect(result.files.map(({ file }) => file)).toEqual([app, broken]);
      expect(located(result, app)).toHaveLength(5);
    },
    TIMEOUT,
  );

  it(
    'marks only a file Vue cannot parse as not checked',
    async () => {
      const dir = project({
        '.oxlintrc.json': JSON.stringify({
          jsPlugins: ['oxlint-tailwindcss'],
          settings: { tailwindcss: { entryPoint: 'src/style.css' } },
          rules: { 'tailwindcss/no-unknown-classes': 'error' },
        }),
        'src/style.css': '@import "tailwindcss";\n',
        'src/Checked.vue':
          '<template>\n  <p class="unknown-checked"></p>\n</template>\n',
        'src/NoTemplate.vue':
          '<script setup lang="ts">\nconst a = 1;\n</script>\n',
        'src/Pug.vue': '<template lang="pug">\n  p.unknown-pug\n</template>\n',
        'src/Unparsable.vue':
          '<template>\n  <p class="unknown-a" v-.trim="x"></p>\n</template>\n',
      });
      const result = await lint({ cwd: dir });
      const reportOf = (name: string) =>
        result.files.find(({ file }) => file === join(dir, 'src', name));
      expect(located(result, join(dir, 'src', 'Checked.vue'))).toEqual([
        {
          rule: 'tailwindcss/no-unknown-classes',
          severity: 'error',
          line: 2,
          column: 12,
        },
      ]);
      expect(result.findings).toHaveLength(1);
      expect(reportOf('Unparsable.vue')).toMatchObject({
        notChecked: 'Vue could not parse this file.',
        skipped: [{ code: 'sfc-parse-error', attribute: '<template>' }],
      });
      expect(reportOf('Pug.vue')).toMatchObject({
        skipped: [{ code: 'template-lang', attribute: '<template>' }],
      });
      expect(reportOf('Pug.vue')).not.toHaveProperty('notChecked');
      expect(reportOf('NoTemplate.vue')).toEqual({
        file: join(dir, 'src', 'NoTemplate.vue'),
        skipped: [],
        notices: [],
      });
    },
    TIMEOUT,
  );

  it(
    'returns no files when no .vue file matches',
    async () => {
      expect(await lint({ cwd: basic, paths: ['src/main.ts'] })).toEqual({
        findings: [],
        files: [],
      });
      expect(createTempRoot).not.toHaveBeenCalled();
    },
    TIMEOUT,
  );
});

describe('user globs', () => {
  it(
    'keeps an override on **/*.ts away from the templates',
    async () => {
      expect(await reportedFiles(['**/*.ts'])).toEqual([
        'src/App.vue',
        'src/legacy/Old.vue',
      ]);
    },
    TIMEOUT,
  );

  it(
    'applies an override on **/*.{js,vue} to the templates',
    async () => {
      expect(await reportedFiles(['**/*.{js,vue}'])).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'applies an override on src/legacy/** to the templates below it',
    async () => {
      expect(await reportedFiles(['src/legacy/**'])).toEqual(['src/App.vue']);
    },
    TIMEOUT,
  );

  it(
    'picks the entry point of the first matching mapping glob',
    async () => {
      const mapping = join(projects, 'mapping');
      const result = await lint({ cwd: mapping });
      expect(located(result, join(mapping, 'src', 'App.vue'))).toEqual([
        {
          rule: 'tailwindcss/no-unknown-classes',
          severity: 'error',
          line: 2,
          column: 14,
        },
      ]);
      expect(result.findings).toHaveLength(1);
    },
    TIMEOUT,
  );
});

describe('lint failures', () => {
  it('throws a ToolError naming a missing path', async () => {
    const missingFile = await rejectionOf(
      lint({ cwd: basic, paths: ['src/Missing.vue'] }),
    );
    const missingFolder = await rejectionOf(
      lint({ cwd: basic, paths: ['missing-dir/App.vue'] }),
    );
    expect(missingFile).toBeInstanceOf(ToolError);
    expect((missingFile as ToolError).message).toBe(
      'Path not found: src/Missing.vue',
    );
    expect(missingFolder).toBeInstanceOf(ToolError);
    expect((missingFolder as ToolError).message).toBe(
      'Path not found: missing-dir/App.vue',
    );
    expect(createTempRoot).not.toHaveBeenCalled();
  });

  it(
    'throws a ToolError when a file has no oxlint config',
    async () => {
      const dir = project({
        'src/App.vue': '<template>\n  <p class="p-2"></p>\n</template>\n',
      });
      const error = await rejectionOf(lint({ cwd: dir }));
      expect(error).toBeInstanceOf(ToolError);
      expect((error as ToolError).message).toContain(
        join(dir, 'src', 'App.vue'),
      );
      expect((error as ToolError).hint).toContain(
        '"jsPlugins": ["oxlint-tailwindcss"]',
      );
    },
    TIMEOUT,
  );

  it(
    'names the .vue file when the plugin crashes',
    async () => {
      const dir = vendorProject('crash');
      const error = await rejectionOf(lint({ cwd: dir }));
      expect(error).toBeInstanceOf(ToolError);
      const { message } = error as ToolError;
      expect(message).toContain(join(dir, 'src', 'App.vue'));
      expect(message).toContain('vendor crash');
      expect(message).not.toContain('.vue.ts');
      expect(message).not.toContain('oxlint-tailwindcss-vue-');
    },
    TIMEOUT,
  );

  it(
    'removes its temp root, even when oxlint fails',
    async () => {
      await lint({ cwd: basic });
      await expect(lint({ cwd: join(projects, 'no-plugin') })).rejects.toThrow(
        ToolError,
      );
      await expect(lint({ cwd: vendorProject('crash') })).rejects.toThrow(
        ToolError,
      );
      const roots = createdRoots();
      expect(roots).toHaveLength(3);
      for (const root of roots) expect(existsSync(root)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'kills oxlint, removes its temp root and rethrows an abort',
    async () => {
      const controller = new AbortController();
      const started = Date.now();
      const outcome = rejectionOf(
        lint({ cwd: vendorProject('hang'), signal: controller.signal }),
      );
      const root = await vi.waitFor(
        () => {
          const [path] = createdRoots();
          if (
            path === undefined ||
            !existsSync(join(path, '0', '.oxlintrc.json'))
          )
            throw new Error('oxlint has not started yet');
          return path;
        },
        { timeout: 30_000, interval: 20 },
      );
      controller.abort();
      expect(await outcome).toBe(controller.signal.reason);
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(existsSync(root)).toBe(false);
    },
    TIMEOUT,
  );

  it('rethrows an abort that came before the run', async () => {
    const signal = AbortSignal.abort();
    await expect(lint({ cwd: basic, signal })).rejects.toBe(signal.reason);
    expect(createTempRoot).not.toHaveBeenCalled();
  });
});

describe('mapDiagnostics', () => {
  const root = join(tmpdir(), 'oxlint-tailwindcss-vue-mapping', '0');
  const cwd = join(root, 'packages', 'app');
  const virtualPath = join(cwd, 'src', 'App.vue.ts');
  const vueFile = join(
    tmpdir(),
    'project',
    'packages',
    'app',
    'src',
    'App.vue',
  );
  const source = '<template>\n  <p class="x">text</p>\n</template>\n';
  const label = { span: { offset: 22, length: 3, line: 2, column: 12 } };

  function setup(): { report: FileReport; context: MappingContext } {
    const report: FileReport = { file: vueFile, skipped: [], notices: [] };
    const files = new Map<string, VirtualSource>([
      [virtualPath, { report, source, code: source }],
    ]);
    return { report, context: { cwd, root, files } };
  }

  function diagnostic(
    fields: Partial<OxlintDiagnostic> = {},
  ): OxlintDiagnostic {
    return {
      message: '"x" is not a valid Tailwind class.',
      code: 'tailwindcss(no-unknown-classes)',
      severity: 'error',
      filename: 'src/App.vue.ts',
      labels: [label],
      ...fields,
    };
  }

  function uncoded(message: string): OxlintDiagnostic {
    return {
      message,
      severity: 'error',
      filename: 'src/App.vue.ts',
      labels: [label],
    };
  }

  it('maps relative, absolute and file URL filenames to the .vue file', () => {
    const findings = mapDiagnostics(
      [
        diagnostic(),
        diagnostic({ filename: virtualPath }),
        diagnostic({ filename: pathToFileURL(virtualPath).href }),
      ],
      setup().context,
    );
    expect(findings).toHaveLength(3);
    for (const finding of findings) {
      expect(finding).toEqual({
        file: vueFile,
        rule: 'tailwindcss/no-unknown-classes',
        severity: 'error',
        message: '"x" is not a valid Tailwind class.',
        start: {
          line: 2,
          column: 12,
          byteColumn: 12,
          offset: 22,
          byteOffset: 22,
        },
        end: {
          line: 2,
          column: 15,
          byteColumn: 15,
          offset: 25,
          byteOffset: 25,
        },
      });
    }
  });

  it('turns codes into rule ids, advice into warnings, and keeps help and url', () => {
    const { context } = setup();
    const [advice] = mapDiagnostics(
      [
        diagnostic({
          code: 'tw(no-duplicate-classes)',
          severity: 'advice',
          help: 'Remove one.',
          url: 'https://example.com/rule',
        }),
      ],
      context,
    );
    expect(advice).toMatchObject({
      rule: 'tw/no-duplicate-classes',
      severity: 'warning',
      help: 'Remove one.',
      url: 'https://example.com/rule',
    });
    const [warning] = mapDiagnostics(
      [diagnostic({ severity: 'warning' })],
      context,
    );
    expect(warning?.severity).toBe('warning');
    expect(warning).not.toHaveProperty('help');
    expect(warning).not.toHaveProperty('url');
  });

  it('rewrites virtual paths inside messages', () => {
    const [finding] = mapDiagnostics(
      [diagnostic({ message: `No mapping matched \`${virtualPath}\`.` })],
      setup().context,
    );
    expect(finding?.message).toBe(`No mapping matched \`${vueFile}\`.`);
  });

  it('places a diagnostic without a label at the start of the file', () => {
    const [finding] = mapDiagnostics(
      [diagnostic({ labels: [] })],
      setup().context,
    );
    expect(finding?.start).toMatchObject({ line: 1, column: 1, offset: 0 });
    expect(finding?.end).toMatchObject({ line: 1, column: 1, offset: 0 });
  });

  it('sets notChecked from a parse error and keeps the first one', () => {
    const { report, context } = setup();
    const findings = mapDiagnostics(
      [uncoded('Invalid regular expression'), uncoded('Unexpected token')],
      context,
    );
    expect(findings).toEqual([]);
    expect(report.notChecked).toBe('Invalid regular expression');
  });

  it('throws a ToolError naming the .vue file when a plugin crashes', () => {
    const crash = uncoded(
      `Error running JS plugin.\nFile path: ${virtualPath}\nError: boom`,
    );
    const error = thrown(() =>
      mapDiagnostics([{ ...crash, labels: [] }], setup().context),
    );
    expect(error).toBeInstanceOf(ToolError);
    const { message } = error as ToolError;
    expect(message).toContain(vueFile);
    expect(message).toContain('Error: boom');
    expect(message).not.toContain(virtualPath);
  });

  it('throws a ToolError for a diagnostic on an unknown file', () => {
    const { context } = setup();
    expect(() =>
      mapDiagnostics([diagnostic({ filename: 'src/Other.vue.ts' })], context),
    ).toThrow(ToolError);
    const { filename: _filename, ...withoutFile } = diagnostic();
    expect(() => mapDiagnostics([withoutFile], context)).toThrow(ToolError);
  });
});

describe('temp roots', () => {
  const tempBase = realpathSync(tmpdir());

  it('creates a real path under the system temp dir and removes it', () => {
    const root = createTempRoot();
    expect(dirname(root.path)).toBe(tempBase);
    expect(root.path).toBe(realpathSync(root.path));
    expect(basename(root.path)).toMatch(/^oxlint-tailwindcss-vue-/);
    root.remove();
    expect(existsSync(root.path)).toBe(false);
    expect(() => root.remove()).not.toThrow();
  });

  it('prunes its own stale temp roots and nothing else', () => {
    const stale = createTempRoot();
    const fresh = createTempRoot();
    const foreign = mkdtempSync(join(tempBase, 'oxlint-tailwindcss-vue-'));
    scratch.push(foreign);
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);
    utimesSync(stale.path, twoDaysAgo, twoDaysAgo);
    utimesSync(foreign, twoDaysAgo, twoDaysAgo);
    try {
      pruneStaleTempRoots(3 * DAY);
      expect(existsSync(stale.path)).toBe(true);
      pruneStaleTempRoots();
      expect(existsSync(stale.path)).toBe(false);
      expect(existsSync(fresh.path)).toBe(true);
      expect(existsSync(foreign)).toBe(true);
    } finally {
      stale.remove();
      fresh.remove();
    }
  });
});

describe('public API', () => {
  it('exports virtualize and lint, and nothing internal', () => {
    expect(Object.keys(api).toSorted()).toEqual(['lint', 'virtualize']);
  });
});
