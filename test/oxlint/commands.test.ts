import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ToolError } from '../../src/errors.js';
import {
  chunkByLength,
  listLintedFiles,
  lintVirtualFiles,
  printConfig,
} from '../../src/oxlint/commands.js';
import { runNode } from '../../src/oxlint/process.js';
import { resolveOxlint } from '../../src/oxlint/resolve.js';

const basic = fileURLToPath(
  new URL('../fixtures/projects/basic/', import.meta.url),
);
const config = join(basic, '.oxlintrc.json');
const oxlint = resolveOxlint([process.cwd()]);
const selection = {
  paths: ['.'],
  ignorePatterns: [] as string[],
  noIgnore: false,
};

describe('chunkByLength', () => {
  it('splits below the limit and keeps the order', () => {
    expect(chunkByLength(['aaa', 'bbb', 'ccc', 'dd'], 9)).toEqual([
      ['aaa', 'bbb'],
      ['ccc', 'dd'],
    ]);
    expect(chunkByLength([], 9)).toEqual([]);
    expect(chunkByLength(['toolongforthelimit'], 9)).toEqual([
      ['toolongforthelimit'],
    ]);
  });
});

describe('runNode', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const result = await runNode(
      '-e',
      [
        'process.stdout.write("o".repeat(300000)); console.error("e"); process.exitCode = 3',
      ],
      { cwd: process.cwd() },
    );
    expect(result.stdout).toHaveLength(300000);
    expect(result.stderr).toBe('e\n');
    expect(result.code).toBe(3);
    expect(result.signal).toBeNull();
  }, 30_000);

  it('removes TERMINAL_EMULATOR from the child env', async () => {
    process.env.TERMINAL_EMULATOR = 'JetBrains-JediTerm';
    try {
      const result = await runNode(
        '-e',
        ['process.stdout.write(String(process.env.TERMINAL_EMULATOR))'],
        { cwd: process.cwd() },
      );
      expect(result.stdout).toBe('undefined');
    } finally {
      delete process.env.TERMINAL_EMULATOR;
    }
  }, 30_000);

  it('kills the child when the signal fires', async () => {
    const controller = new AbortController();
    const pending = runNode('-e', ['setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const result = await pending;
    expect(result.signal).toBe('SIGTERM');
  }, 30_000);

  it('kills at once when the signal is already aborted', async () => {
    const result = await runNode('-e', ['setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
      signal: AbortSignal.abort(),
    });
    expect(result.signal).toBe('SIGTERM');
  }, 30_000);
});

describe('real oxlint', () => {
  it('printConfig keeps settings.tailwindcss.entryPoint', async () => {
    const printed = await printConfig(oxlint, basic, config);
    expect(printed.settings).toMatchObject({
      tailwindcss: { entryPoint: 'src/style.css' },
    });
    expect(printed.overrides?.[0]?.files).toEqual(['src/legacy/**/*.vue']);
  }, 60_000);

  it('printConfig throws a ToolError on a broken config', async () => {
    await expect(
      printConfig(oxlint, basic, join(basic, 'missing.json')),
    ).rejects.toThrow(ToolError);
  }, 60_000);

  it('listLintedFiles returns only .vue files and honors ignorePatterns', async () => {
    const files = await listLintedFiles(oxlint, basic, {
      ...selection,
      config,
    });
    expect(files.toSorted()).toEqual(
      [
        join(basic, 'src/App.vue'),
        join(basic, 'src/Clean.vue'),
        join(basic, 'src/legacy/Old.vue'),
      ].toSorted(),
    );
  }, 60_000);

  it('listLintedFiles honors --ignore-pattern and explicit paths', async () => {
    const files = await listLintedFiles(oxlint, basic, {
      ...selection,
      paths: ['src'],
      config,
      ignorePatterns: ['src/legacy/**'],
    });
    expect(files.toSorted()).toEqual(
      [join(basic, 'src/App.vue'), join(basic, 'src/Clean.vue')].toSorted(),
    );
  }, 60_000);

  it('listLintedFiles passes --ignore-path to oxlint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'otv-ignore-'));
    try {
      const ignorePath = join(dir, 'ignore');
      writeFileSync(ignorePath, 'Clean.vue\n');
      const files = await listLintedFiles(oxlint, basic, {
        ...selection,
        config,
        ignorePath,
      });
      expect(files).not.toContain(join(basic, 'src/Clean.vue'));
      expect(files).toContain(join(basic, 'src/App.vue'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('listLintedFiles passes --no-ignore and keeps the config ignorePatterns', async () => {
    const files = await listLintedFiles(oxlint, basic, {
      ...selection,
      config,
      noIgnore: true,
    });
    expect(files).toContain(join(basic, 'src/App.vue'));
    expect(files).not.toContain(join(basic, 'dist/ignored.vue'));
  }, 60_000);

  it('listLintedFiles throws a ToolError for a missing config', async () => {
    await expect(
      listLintedFiles(oxlint, basic, {
        ...selection,
        config: join(basic, 'missing.json'),
      }),
    ).rejects.toThrow(ToolError);
  }, 60_000);

  it('listLintedFiles throws a ToolError for a missing --ignore-path file', async () => {
    await expect(
      listLintedFiles(oxlint, basic, {
        ...selection,
        config,
        ignorePath: join(basic, 'missing-ignore'),
      }),
    ).rejects.toThrow(/missing-ignore/);
  }, 60_000);

  it('listLintedFiles throws a ToolError when oxlint exits with an error on stderr', async () => {
    await expect(
      listLintedFiles(oxlint, basic, {
        ...selection,
        paths: ['--not-a-flag'],
        config,
      }),
    ).rejects.toThrow(ToolError);
  }, 60_000);

  it('listLintedFiles returns an empty list when nothing matches', async () => {
    const files = await listLintedFiles(oxlint, basic, {
      ...selection,
      paths: ['src/Missing.vue'],
      config,
    });
    expect(files).toEqual([]);
  }, 60_000);

  it('lintVirtualFiles throws when number_of_files differs from the paths sent', async () => {
    await expect(
      lintVirtualFiles(oxlint, {
        configPath: config,
        cwd: basic,
        files: [join(basic, 'src/main.ts'), join(basic, 'src/Missing.ts')],
      }),
    ).rejects.toThrow(/checked 1 files, expected 2/);
  }, 60_000);

  it('lintVirtualFiles returns the report of the files it was given', async () => {
    const report = await lintVirtualFiles(oxlint, {
      configPath: config,
      cwd: basic,
      files: ['src/main.ts'],
    });
    expect(report.number_of_files).toBe(1);
    expect(report.diagnostics).toEqual([]);
  }, 60_000);

  it('lintVirtualFiles throws a ToolError when aborted', async () => {
    await expect(
      lintVirtualFiles(oxlint, {
        configPath: config,
        cwd: basic,
        files: ['src/main.ts'],
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow(ToolError);
  }, 60_000);

  it('lintVirtualFiles throws a ToolError on a config error', async () => {
    await expect(
      lintVirtualFiles(oxlint, {
        configPath: join(basic, 'missing.json'),
        cwd: basic,
        files: [join(basic, 'src/main.ts')],
      }),
    ).rejects.toThrow(ToolError);
  }, 60_000);
});
