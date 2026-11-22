import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { ToolError } from '../errors.js';

export interface OxlintInstall {
  bin: string;
  version: string;
}

const MIN_VERSION = [1, 94, 0] as const;
const CONFIG_NAMES = [
  '.oxlintrc.json',
  '.oxlintrc.jsonc',
  'oxlint.config.ts',
  'oxlint.config.mts',
];

function isBelowMinimum(version: string): boolean {
  const parts = version.split('-')[0]?.split('.').map(Number) ?? [];
  for (const [index, minimum] of MIN_VERSION.entries()) {
    const part = parts[index] ?? 0;
    if (part !== minimum) return part < minimum;
  }
  return false;
}

function* ancestors(start: string): Generator<string> {
  let dir = resolve(start);
  for (;;) {
    yield dir;
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function binPath(packageDir: string, pkg: { bin?: unknown }): string {
  const bin = pkg.bin;
  const relative =
    typeof bin === 'string'
      ? bin
      : ((bin as { oxlint?: string } | undefined)?.oxlint ?? 'bin/oxlint');
  return join(packageDir, relative);
}

export function resolveOxlint(fromDirs: readonly string[]): OxlintInstall {
  for (const from of fromDirs) {
    for (const dir of ancestors(from)) {
      const packageDir = join(dir, 'node_modules', 'oxlint');
      const manifest = join(packageDir, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
        version: string;
        bin?: unknown;
      };
      if (isBelowMinimum(pkg.version)) {
        throw new ToolError(
          `oxlint ${pkg.version} is installed, but oxlint-tailwindcss-vue needs 1.94.0 or newer`,
          'Upgrade it with your package manager, for example: npm install -D oxlint@latest',
        );
      }
      return { bin: binPath(packageDir, pkg), version: pkg.version };
    }
  }
  throw new ToolError(
    'oxlint was not found in the project',
    'Install it with your package manager, for example: npm install -D oxlint',
  );
}

export function findConfigFile(startDir: string): string | undefined {
  for (const dir of ancestors(startDir)) {
    for (const name of CONFIG_NAMES) {
      const file = join(dir, name);
      if (existsSync(file)) return file;
    }
  }
  return undefined;
}
