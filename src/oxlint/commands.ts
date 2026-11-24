import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { ToolError } from '../errors.js';
import { runNode } from './process.js';
import { parseOxlintReport, type OxlintReport } from './report.js';
import type { OxlintInstall } from './resolve.js';

export type PluginEntry = string | { name: string; specifier: string };

export type PrintedConfig = {
  jsPlugins?: PluginEntry[];
  settings?: Record<string, unknown>;
  rules?: Record<string, unknown>;
  overrides?: {
    files: string[];
    excludeFiles?: string[];
    jsPlugins?: PluginEntry[];
    rules?: Record<string, unknown>;
  }[];
  options?: Record<string, unknown>;
};

export interface FileSelection {
  paths: string[];
  config?: string;
  ignorePath?: string;
  ignorePatterns: string[];
  noIgnore: boolean;
}

const MAX_ARGS_LENGTH = 30_000;

function failure(action: string, stdout: string, stderr: string): ToolError {
  const text = `${stdout}\n${stderr}`.trim();
  return new ToolError(
    text === ''
      ? `oxlint failed to ${action}`
      : `oxlint failed to ${action}:\n${text}`,
  );
}

export async function printConfig(
  oxlint: OxlintInstall,
  cwd: string,
  configFile: string,
): Promise<PrintedConfig> {
  const { stdout, stderr, code } = await runNode(
    oxlint.bin,
    ['-c', configFile, '--print-config'],
    { cwd },
  );
  const start = stdout.indexOf('{');
  if (code !== 0 || start === -1)
    throw failure('print the config', stdout, stderr);
  try {
    return JSON.parse(stdout.slice(start)) as PrintedConfig;
  } catch {
    throw failure('print the config', stdout, stderr);
  }
}

export async function listLintedFiles(
  oxlint: OxlintInstall,
  cwd: string,
  selection: FileSelection,
): Promise<string[]> {
  const args = ['--debug=files'];
  if (selection.config !== undefined) args.push('-c', selection.config);
  if (selection.ignorePath !== undefined) {
    args.push('--ignore-path', selection.ignorePath);
  }
  for (const pattern of selection.ignorePatterns) {
    args.push('--ignore-pattern', pattern);
  }
  if (selection.noIgnore) args.push('--no-ignore');
  args.push(...selection.paths);

  if (
    selection.ignorePath !== undefined &&
    !existsSync(resolve(cwd, selection.ignorePath))
  ) {
    throw new ToolError(`Ignore file not found: ${selection.ignorePath}`);
  }

  // oxlint 1.94 exits 0 with an empty list for an unmatched path and for a
  // missing --ignore-path file; every real failure exits 1.
  const { stdout, stderr, code } = await runNode(oxlint.bin, args, { cwd });
  if (code !== 0) throw failure('list the files', stdout, stderr);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.vue'))
    .map((line) => resolve(cwd, line));
}

export function chunkByLength(
  items: readonly string[],
  limit: number,
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const item of items) {
    if (current.length > 0 && length + item.length + 1 > limit) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(item);
    length += item.length + 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function lintVirtualFiles(
  oxlint: OxlintInstall,
  options: {
    configPath: string;
    cwd: string;
    files: readonly string[];
    signal?: AbortSignal;
  },
): Promise<OxlintReport & { stderr: string }> {
  const relatives = options.files.map((file) => {
    if (!isAbsolute(file)) return file;
    const path = relative(options.cwd, file);
    // oxlint 1.94 exits with "PATH must not contain .." on such an argument,
    // and takes an absolute path outside its cwd.
    return path.startsWith('..') ? file : path;
  });
  const merged: OxlintReport & { stderr: string } = {
    diagnostics: [],
    number_of_files: 0,
    stderr: '',
  };
  for (const chunk of chunkByLength(relatives, MAX_ARGS_LENGTH)) {
    // oxlint already uses every core; chunks run one after the other.
    // oxlint-disable-next-line no-await-in-loop
    const { stdout, stderr, signal } = await runNode(
      oxlint.bin,
      [
        '-c',
        options.configPath,
        '--format',
        'json',
        '-A',
        'all',
        '--no-error-on-unmatched-pattern',
        ...chunk,
      ],
      options.signal === undefined
        ? { cwd: options.cwd }
        : { cwd: options.cwd, signal: options.signal },
    );
    if (signal !== null) throw new ToolError(`oxlint was stopped by ${signal}`);
    let report: OxlintReport;
    try {
      report = parseOxlintReport(stdout);
    } catch (error) {
      if (error instanceof ToolError && stderr.trim() !== '') {
        throw new ToolError(`${error.message}\n${stderr.trim()}`);
      }
      throw error;
    }
    if (report.number_of_files !== chunk.length) {
      throw new ToolError(
        `oxlint checked ${report.number_of_files} files, expected ${chunk.length}`,
        'A virtual file was ignored or missing. Check the ignorePatterns of your oxlint config.',
      );
    }
    merged.diagnostics.push(...report.diagnostics);
    merged.number_of_files += report.number_of_files;
    merged.stderr += stderr;
  }
  return merged;
}
