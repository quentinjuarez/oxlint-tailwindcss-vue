import { readFileSync } from 'node:fs';

import { ToolError, UsageError } from '../errors.js';
import { lint } from '../lint.js';
import { exitCodeFor, formatReport } from '../output/format.js';
import { parseCliArgs, type CliOptions } from './args.js';

export interface CliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

const HELP = `Usage: oxlint-tailwindcss-vue [options] [paths...]

Lint the Tailwind CSS classes of Vue templates with your own oxlint and
oxlint-tailwindcss.

Options:
  -c, --config <path>       oxlint config file (default: oxlint's lookup)
      --ignore-path <path>  passed to oxlint's file selection
      --ignore-pattern <p>  passed to oxlint's file selection, repeatable
      --no-ignore           passed to oxlint's file selection
  -f, --format <name>       default, json or github
      --quiet               report errors only
      --max-warnings <n>    exit 1 above n warnings
      --deny-warnings       exit 1 on any warning
      --debug               list skipped attributes with their reason
                            (default format only), and print the stack of
                            an unexpected error
  -h, --help                show this help
  -V, --version             show the version

Exit codes:
  0    no error, and warnings within --max-warnings
  1    an error, a file that could not be parsed, or too many warnings
  2    tool failure
  130  interrupted by SIGINT
  143  interrupted by SIGTERM
`;

const SIGNAL_CODES: Record<string, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  SIGBREAK: 149,
};

export async function main(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  let debug = false;
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.kind === 'help') {
      io.stdout.write(HELP);
      return 0;
    }
    if (parsed.kind === 'version') {
      io.stdout.write(`${readVersion()}\n`);
      return 0;
    }
    ({ debug } = parsed.options);
    return await run(parsed.options, io);
  } catch (error) {
    if (io.signal?.aborted) return interruptedCode(io.signal.reason);
    return fail(error, io, debug);
  }
}

async function run(options: CliOptions, io: CliIo): Promise<number> {
  const { format, quiet, maxWarnings, denyWarnings, debug, ...lintOptions } =
    options;
  const result = await lint({
    ...lintOptions,
    cwd: io.cwd,
    ...(io.signal === undefined ? {} : { signal: io.signal }),
  });
  if (result.files.length === 0) {
    const notice = 'No .vue files to check.\n';
    if (format === 'default') {
      io.stdout.write(notice);
    } else {
      io.stdout.write(
        formatReport(result, format, {
          cwd: io.cwd,
          quiet,
          debug,
          color: false,
        }),
      );
      io.stderr.write(notice);
    }
    return 0;
  }
  const color = format === 'default' && wantsColor(io);
  io.stdout.write(
    formatReport(result, format, { cwd: io.cwd, quiet, debug, color }),
  );
  return exitCodeFor(result, {
    quiet,
    denyWarnings,
    ...(maxWarnings === undefined ? {} : { maxWarnings }),
  });
}

function wantsColor({ stdout, env }: CliIo): boolean {
  const forced = env.FORCE_COLOR;
  if (forced === '0' || forced === 'false') return false;
  if (forced !== undefined && forced !== '') return true;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  return (stdout as { isTTY?: boolean }).isTTY === true;
}

function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

function interruptedCode(reason: unknown): number {
  return (typeof reason === 'string' && SIGNAL_CODES[reason]) || 130;
}

function fail(error: unknown, io: CliIo, debug: boolean): number {
  if (error instanceof UsageError) {
    io.stderr.write(`${error.message}\nRun with --help for usage.\n`);
    return 2;
  }
  if (error instanceof ToolError) {
    io.stderr.write(`${error.message}\n`);
    if (error.hint !== undefined) io.stderr.write(`${error.hint}\n`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`Unexpected error: ${message}\n`);
  }
  const unexpected = error instanceof ToolError ? error.cause : error;
  if (debug && unexpected instanceof Error && unexpected.stack !== undefined) {
    io.stderr.write(`${unexpected.stack}\n`);
  }
  return 2;
}
