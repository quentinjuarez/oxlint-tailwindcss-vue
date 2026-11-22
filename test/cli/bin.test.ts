import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const basic = fileURLToPath(
  new URL('../fixtures/projects/basic', import.meta.url),
);
const version = (
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

describe('the built command', () => {
  it('prints its version', () => {
    const result = spawnSync(process.execPath, [bin, '--version'], {
      encoding: 'utf8',
    });
    expect(result.stdout).toBe(`${version}\n`);
    expect(result.status).toBe(0);
  });

  it('exits 1 on the basic project', { timeout: 60_000 }, () => {
    const result = spawnSync(process.execPath, [bin], {
      cwd: basic,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('src/App.vue:');
  });
});
