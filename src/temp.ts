import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempRoot {
  path: string;
  remove(): void;
}

const PREFIX = 'oxlint-tailwindcss-vue-';
const MARKER = '.oxlint-tailwindcss-vue';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function tempBase(): string {
  return realpathSync(tmpdir());
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // pruneStaleTempRoots removes what is left on a later run.
  }
}

export function createTempRoot(): TempRoot {
  const path = realpathSync(mkdtempSync(join(tempBase(), PREFIX)));
  writeFileSync(join(path, MARKER), '');
  return { path, remove: () => removeQuietly(path) };
}

export function pruneStaleTempRoots(maxAgeMs = ONE_DAY_MS): void {
  const base = tempBase();
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const path = join(base, name);
    try {
      const isStale = now - statSync(path).mtimeMs > maxAgeMs;
      if (isStale && existsSync(join(path, MARKER))) removeQuietly(path);
    } catch {
      continue;
    }
  }
}
