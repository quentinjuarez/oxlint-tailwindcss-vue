import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { main } from '../src/cli/main.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const example = fileURLToPath(
  new URL('fixtures/projects/readme-example', import.meta.url),
);
const EXAMPLE_BLOCK =
  /```console\n\$ npx oxlint-tailwindcss-vue\n([\s\S]*?)```/;

class Sink extends Writable {
  text = '';
  override _write(chunk: Buffer, _encoding: string, done: () => void) {
    this.text += chunk.toString();
    done();
  }
}

describe('the README example', () => {
  it('prints exactly the output shown in the README', async () => {
    const shown = EXAMPLE_BLOCK.exec(readme)?.[1];
    const stdout = new Sink();
    const code = await main([], {
      stdout,
      stderr: new Sink(),
      cwd: example,
      env: { NO_COLOR: '1' },
    });
    expect(code).toBe(1);
    expect(shown).toBeDefined();
    expect(stdout.text.split(sep).join('/')).toBe(shown);
  }, 60_000);
});
