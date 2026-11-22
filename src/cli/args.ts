import { parseArgs } from 'node:util';

import { UsageError } from '../errors.js';
import type { LintOptions } from '../lint.js';
import type { OutputFormat } from '../output/format.js';

export interface CliOptions extends LintOptions {
  format: OutputFormat;
  quiet: boolean;
  maxWarnings?: number;
  denyWarnings: boolean;
  debug: boolean;
}

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; options: CliOptions };

const FORMATS: readonly string[] = ['default', 'json', 'github'];

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        config: { type: 'string', short: 'c' },
        'ignore-path': { type: 'string' },
        'ignore-pattern': { type: 'string', multiple: true },
        'no-ignore': { type: 'boolean' },
        format: { type: 'string', short: 'f' },
        quiet: { type: 'boolean' },
        'max-warnings': { type: 'string' },
        'deny-warnings': { type: 'boolean' },
        debug: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
      },
    }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  const format = values.format ?? 'default';
  if (!FORMATS.includes(format)) {
    throw new UsageError(
      `Unknown format "${format}". Use default, json or github.`,
    );
  }
  const options: CliOptions = {
    paths: positionals,
    ignorePatterns: values['ignore-pattern'] ?? [],
    noIgnore: values['no-ignore'] ?? false,
    format: format as OutputFormat,
    quiet: values.quiet ?? false,
    denyWarnings: values['deny-warnings'] ?? false,
    debug: values.debug ?? false,
  };
  if (values.config !== undefined) options.config = values.config;
  if (values['ignore-path'] !== undefined) {
    options.ignorePath = values['ignore-path'];
  }
  if (values['max-warnings'] !== undefined) {
    options.maxWarnings = parseLimit(values['max-warnings']);
  }
  return { kind: 'run', options };
}

function parseLimit(text: string): number {
  if (!/^\d+$/.test(text)) {
    throw new UsageError(
      `--max-warnings expects a non-negative integer, got "${text}".`,
    );
  }
  return Number(text);
}
