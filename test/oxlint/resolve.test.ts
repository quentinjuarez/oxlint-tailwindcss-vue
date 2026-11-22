import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ToolError } from '../../src/errors.js';
import { findConfigFile, resolveOxlint } from '../../src/oxlint/resolve.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'otv-resolve-'));
  dirs.push(dir);
  return dir;
}

function touch(dir: string, name: string): string {
  const file = join(dir, name);
  writeFileSync(file, '{}');
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('findConfigFile', () => {
  it('prefers .oxlintrc.json, then .oxlintrc.jsonc, then the TS configs', () => {
    const dir = tempDir();
    touch(dir, 'oxlint.config.mts');
    expect(findConfigFile(dir)).toBe(join(dir, 'oxlint.config.mts'));
    touch(dir, 'oxlint.config.ts');
    expect(findConfigFile(dir)).toBe(join(dir, 'oxlint.config.ts'));
    touch(dir, '.oxlintrc.jsonc');
    expect(findConfigFile(dir)).toBe(join(dir, '.oxlintrc.jsonc'));
    touch(dir, '.oxlintrc.json');
    expect(findConfigFile(dir)).toBe(join(dir, '.oxlintrc.json'));
  });

  it('walks up to the parent directory', () => {
    const dir = tempDir();
    const config = touch(dir, '.oxlintrc.json');
    const child = join(dir, 'a', 'b');
    mkdirSync(child, { recursive: true });
    expect(findConfigFile(child)).toBe(config);
  });

  it('returns undefined when no directory has a config', () => {
    expect(findConfigFile(tempDir())).toBeUndefined();
  });
});

describe('resolveOxlint', () => {
  it('resolves this repository oxlint', () => {
    const install = resolveOxlint([process.cwd()]);
    expect(install.version).toBe('1.94.0');
    expect(install.bin).toMatch(/oxlint[\\/]bin[\\/]oxlint$/);
  });

  it('tries the next directory when the first has no oxlint', () => {
    const install = resolveOxlint([tempDir(), process.cwd()]);
    expect(install.version).toBe('1.94.0');
  });

  it('refuses a version below 1.94.0', () => {
    const dir = tempDir();
    const pkg = join(dir, 'node_modules', 'oxlint');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'oxlint',
        version: '1.93.0',
        bin: { oxlint: 'bin/oxlint' },
      }),
    );
    writeFileSync(join(pkg, 'bin', 'oxlint'), '');
    const error = (() => {
      try {
        resolveOxlint([dir]);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).message).toContain('1.94.0');
    expect((error as ToolError).message).toContain('1.93.0');
    expect((error as ToolError).hint).toMatch(/upgrade|update/i);
  });

  it('throws a ToolError when oxlint is nowhere', () => {
    expect(() => resolveOxlint([tempDir()])).toThrow(ToolError);
  });
});
