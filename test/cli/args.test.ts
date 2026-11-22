import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../../src/cli/args.js';
import { UsageError } from '../../src/errors.js';

function runOptions(argv: string[]) {
  const parsed = parseCliArgs(argv);
  if (parsed.kind !== 'run') throw new Error('expected a run');
  return parsed.options;
}

describe('parseCliArgs', () => {
  it('has defaults without arguments', () => {
    expect(runOptions([])).toEqual({
      paths: [],
      ignorePatterns: [],
      noIgnore: false,
      format: 'default',
      quiet: false,
      denyWarnings: false,
      debug: false,
    });
  });

  it('parses help and version', () => {
    expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['-V'])).toEqual({ kind: 'version' });
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('parses every flag', () => {
    expect(
      runOptions([
        '-c',
        'lint.json',
        '--ignore-path',
        '.ignore',
        '--ignore-pattern',
        'a/**',
        '--ignore-pattern',
        'b/**',
        '--no-ignore',
        '-f',
        'json',
        '--quiet',
        '--max-warnings',
        '3',
        '--deny-warnings',
        '--debug',
        'src',
        'App.vue',
      ]),
    ).toEqual({
      paths: ['src', 'App.vue'],
      config: 'lint.json',
      ignorePath: '.ignore',
      ignorePatterns: ['a/**', 'b/**'],
      noIgnore: true,
      format: 'json',
      quiet: true,
      maxWarnings: 3,
      denyWarnings: true,
      debug: true,
    });
  });

  it('parses the long forms', () => {
    const options = runOptions(['--config=x.json', '--format=github']);
    expect(options.config).toBe('x.json');
    expect(options.format).toBe('github');
  });

  it('accepts zero as a warning limit', () => {
    expect(runOptions(['--max-warnings', '0']).maxWarnings).toBe(0);
  });

  it('rejects an unknown format', () => {
    expect(() => parseCliArgs(['--format', 'xml'])).toThrow(UsageError);
    expect(() => parseCliArgs(['--format', 'xml'])).toThrow(/xml/);
  });

  it.each(['abc', '-1', '1.5', ''])('rejects --max-warnings %j', (value) => {
    expect(() => parseCliArgs(['--max-warnings', value])).toThrow(UsageError);
  });

  it('rejects an unknown option and a missing value', () => {
    expect(() => parseCliArgs(['--nope'])).toThrow(UsageError);
    expect(() => parseCliArgs(['--config'])).toThrow(UsageError);
  });
});
