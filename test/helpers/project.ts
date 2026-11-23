import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeModules = fileURLToPath(
  new URL('../../node_modules', import.meta.url),
);
const scratch: string[] = [];

export function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'otv-lint-')));
  scratch.push(dir);
  return dir;
}

export function project(files: Record<string, string>): string {
  const dir = scratchDir();
  symlinkSync(nodeModules, join(dir, 'node_modules'), 'junction');
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

export function removeScratchDirs(): void {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
