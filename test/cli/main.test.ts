import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { main } from '../../src/cli/main.js';
import { ToolError } from '../../src/errors.js';
import * as lintModule from '../../src/lint.js';

const projects = fileURLToPath(
  new URL('../fixtures/projects/', import.meta.url),
);
const basic = `${projects}basic`;
const noPlugin = `${projects}no-plugin`;
const TIMEOUT = 60_000;

class Sink extends Writable {
  text = '';
  isTTY = false;
  override _write(chunk: Buffer, _encoding: string, done: () => void) {
    this.text += chunk.toString();
    done();
  }
}

async function run(
  argv: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    tty?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  const stdout = new Sink();
  const stderr = new Sink();
  stdout.isTTY = options.tty ?? false;
  const code = await main(argv, {
    stdout,
    stderr,
    cwd: options.cwd ?? basic,
    env: options.env ?? {},
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return { code, out: stdout.text, err: stderr.text };
}

const version = (
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

describe('main', () => {
  it('prints the help and returns 0', async () => {
    const { code, out } = await run(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('oxlint-tailwindcss-vue [options] [paths...]');
    expect(out).toContain('--max-warnings');
  });

  it('prints the version', async () => {
    const { code, out } = await run(['-V']);
    expect(code).toBe(0);
    expect(out).toBe(`${version}\n`);
  });

  it('reports a usage error', async () => {
    const { code, out, err } = await run(['--format', 'xml']);
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toContain('xml');
    expect(err).toContain('Run with --help');
  });

  it(
    'exits 0 when no .vue file matches',
    async () => {
      const { code, out } = await run(['--ignore-pattern', '**/*.vue']);
      expect(code).toBe(0);
      expect(out).toBe('No .vue files to check.\n');
    },
    TIMEOUT,
  );

  it(
    'exits 2 on a missing path',
    async () => {
      const { code, err } = await run(['nope/Missing.vue']);
      expect(code).toBe(2);
      expect(err).toContain('nope/Missing.vue');
    },
    TIMEOUT,
  );

  it(
    'exits 2 with the preflight message',
    async () => {
      const { code, err } = await run([], { cwd: noPlugin });
      expect(code).toBe(2);
      expect(err.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'returns 1 and prints the findings of the basic project',
    async () => {
      const { code, out } = await run([]);
      expect(code).toBe(1);
      expect(out).toContain('src/App.vue:');
      expect(out).not.toContain('\u001B[');
    },
    TIMEOUT,
  );

  it(
    'prints json without color even when forced',
    async () => {
      const { out } = await run(['-f', 'json'], {
        env: { FORCE_COLOR: '1' },
        tty: true,
      });
      expect(JSON.parse(out)).toHaveProperty('diagnostics');
    },
    TIMEOUT,
  );

  describe('colors', () => {
    it.each([
      ['a TTY', { tty: true, env: {} }, true],
      ['a TTY with NO_COLOR', { tty: true, env: { NO_COLOR: '1' } }, false],
      ['a pipe', { tty: false, env: {} }, false],
      ['FORCE_COLOR=1', { tty: false, env: { FORCE_COLOR: '1' } }, true],
      [
        'FORCE_COLOR=0 on a TTY',
        { tty: true, env: { FORCE_COLOR: '0' } },
        true,
      ],
      [
        'FORCE_COLOR=0 on a pipe',
        { tty: false, env: { FORCE_COLOR: '0' } },
        false,
      ],
    ])('%s', async (_name, io, colored) => {
      const lint = vi.spyOn(lintModule, 'lint');
      lint.mockResolvedValue({
        findings: [
          {
            file: `${basic}/src/App.vue`,
            rule: 'r/x',
            severity: 'error',
            message: 'm',
            start: {
              line: 1,
              column: 1,
              offset: 0,
              byteOffset: 0,
              byteColumn: 1,
            },
            end: {
              line: 1,
              column: 2,
              offset: 1,
              byteOffset: 1,
              byteColumn: 2,
            },
          },
        ],
        files: [{ file: `${basic}/src/App.vue`, skipped: [], notices: [] }],
      } as never);
      const { out } = await run([], io);
      expect(out.includes('\u001B[')).toBe(colored);
      lint.mockRestore();
    });
  });

  describe('failures', () => {
    it('prints the message and hint of a ToolError', async () => {
      const lint = vi
        .spyOn(lintModule, 'lint')
        .mockRejectedValue(new ToolError('broke', 'try this'));
      const { code, err } = await run([]);
      lint.mockRestore();
      expect(code).toBe(2);
      expect(err).toBe('broke\ntry this\n');
    });

    it('prints a ToolError without hint', async () => {
      const lint = vi
        .spyOn(lintModule, 'lint')
        .mockRejectedValue(new ToolError('broke'));
      const { err } = await run([]);
      lint.mockRestore();
      expect(err).toBe('broke\n');
    });

    it('prints a short message for an unexpected error', async () => {
      const lint = vi
        .spyOn(lintModule, 'lint')
        .mockRejectedValue(new Error('kaput'));
      const { code, err } = await run([]);
      lint.mockRestore();
      expect(code).toBe(2);
      expect(err).toContain('kaput');
    });

    it('prints a non-Error rejection', async () => {
      const lint = vi.spyOn(lintModule, 'lint').mockRejectedValue('odd');
      const { err } = await run([]);
      lint.mockRestore();
      expect(err).toContain('odd');
    });

    it.each([
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ])('returns %s as %i', async (reason, expected) => {
      const controller = new AbortController();
      const lint = vi.spyOn(lintModule, 'lint').mockImplementation(() => {
        controller.abort(reason);
        return Promise.reject(controller.signal.reason);
      });
      const { code, err } = await run([], { signal: controller.signal });
      lint.mockRestore();
      expect(code).toBe(expected);
      expect(err).toBe('');
    });

    it('returns 130 for an abort with another reason', async () => {
      const controller = new AbortController();
      controller.abort();
      const lint = vi
        .spyOn(lintModule, 'lint')
        .mockRejectedValue(new Error('x'));
      const { code } = await run([], { signal: controller.signal });
      lint.mockRestore();
      expect(code).toBe(130);
    });
  });
});
