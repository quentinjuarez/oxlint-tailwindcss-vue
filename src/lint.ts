import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from 'node:path';

import { deriveConfig, tailwindSettingsOf } from './config/derive.js';
import { ToolError } from './errors.js';
import { mapDiagnostics, type VirtualSource } from './map-diagnostics.js';
import {
  listLintedFiles,
  lintVirtualFiles,
  printConfig,
  type FileSelection,
} from './oxlint/commands.js';
import {
  findConfigFile,
  resolveOxlint,
  type OxlintInstall,
} from './oxlint/resolve.js';
import type { Position } from './positions.js';
import { createTempRoot, pruneStaleTempRoots } from './temp.js';
import type { Notice, Skip } from './virtual/types.js';
import { virtualize } from './virtual/virtualize.js';

export interface LintOptions {
  cwd?: string;
  paths?: string[];
  config?: string;
  ignorePath?: string;
  ignorePatterns?: string[];
  noIgnore?: boolean;
  signal?: AbortSignal;
}

export interface Finding {
  file: string;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  help?: string;
  url?: string;
  start: Position;
  end: Position;
}

export interface FileReport {
  file: string;
  skipped: Skip[];
  notices: Notice[];
  notChecked?: string;
}

export interface LintResult {
  findings: Finding[];
  files: FileReport[];
}

interface GroupRun {
  oxlint: OxlintInstall;
  cwd: string;
  configFile: string;
  files: readonly string[];
  dir: string;
  signal: AbortSignal | undefined;
}

const EXTERNAL = '_external';
const VUE_PARSE_ERROR = 'Vue could not parse this file.';

export async function lint(options: LintOptions = {}): Promise<LintResult> {
  try {
    return await run(options);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    throw error;
  }
}

async function run(options: LintOptions): Promise<LintResult> {
  const { signal } = options;
  signal?.throwIfAborted();
  pruneStaleTempRoots();
  const cwd = resolve(options.cwd ?? process.cwd());
  const paths = options.paths ?? [];
  for (const path of paths) {
    if (!existsSync(resolve(cwd, path))) {
      throw new ToolError(`Path not found: ${path}`);
    }
  }
  const userConfig =
    options.config === undefined ? undefined : resolve(cwd, options.config);
  const rootConfig = userConfig ?? findConfigFile(cwd);
  const oxlint = resolveOxlint(
    rootConfig === undefined ? [cwd] : [dirname(rootConfig), cwd],
  );
  const listed = await listLintedFiles(oxlint, cwd, selectionOf(options));
  signal?.throwIfAborted();
  if (listed.length === 0) return { findings: [], files: [] };
  const groups = groupByConfig([...new Set(listed)], userConfig);

  const temp = createTempRoot();
  try {
    const findings: Finding[] = [];
    const files: FileReport[] = [];
    for (const [index, [configFile, groupFiles]] of [...groups].entries()) {
      // oxlint already uses every core; groups run one after the other.
      // oxlint-disable-next-line no-await-in-loop
      const result = await lintGroup({
        oxlint,
        cwd,
        configFile,
        files: groupFiles,
        dir: join(temp.path, String(index)),
        signal,
      });
      findings.push(...result.findings);
      files.push(...result.files);
    }
    return {
      findings: findings.toSorted(compareFindings),
      files: files.toSorted((a, b) => compareText(a.file, b.file)),
    };
  } finally {
    temp.remove();
  }
}

function selectionOf(options: LintOptions): FileSelection {
  const selection: FileSelection = {
    paths: options.paths ?? [],
    ignorePatterns: options.ignorePatterns ?? [],
    noIgnore: options.noIgnore ?? false,
  };
  if (options.config !== undefined) selection.config = options.config;
  if (options.ignorePath !== undefined) {
    selection.ignorePath = options.ignorePath;
  }
  return selection;
}

function groupByConfig(
  files: readonly string[],
  userConfig: string | undefined,
): Map<string, string[]> {
  return Map.groupBy(files, (file) => {
    const configFile = userConfig ?? findConfigFile(dirname(file));
    if (configFile === undefined) {
      throw new ToolError(
        `No oxlint config file found for ${file}`,
        'Add an .oxlintrc.json with "jsPlugins": ["oxlint-tailwindcss"] to your project.',
      );
    }
    return configFile;
  });
}

async function lintGroup(group: GroupRun): Promise<LintResult> {
  const { oxlint, cwd, configFile, dir, signal } = group;
  const printed = await printConfig(oxlint, cwd, configFile);
  signal?.throwIfAborted();
  const configDir = dirname(configFile);
  const settings = tailwindSettingsOf(printed);
  const files: FileReport[] = [];
  const sources = new Map<string, VirtualSource & { styleClasses: string[] }>();
  for (const file of group.files) {
    const source = readFileSync(file, 'utf8');
    const { code, skipped, notices, styleClasses } = virtualize(
      source,
      settings,
    );
    const report: FileReport = { file, skipped, notices };
    files.push(report);
    if (code === null) {
      if (skipped.some((skip) => skip.code === 'sfc-parse-error')) {
        report.notChecked = VUE_PARSE_ERROR;
      }
      continue;
    }
    const virtualPath = `${mirror(dir, configDir, file)}.ts`;
    mkdirSync(dirname(virtualPath), { recursive: true });
    writeFileSync(virtualPath, code);
    sources.set(virtualPath, { report, source, code, styleClasses });
  }

  const derived = deriveConfig({
    printed,
    configFile,
    cwd,
    files: [...sources].map(([virtualPath, { styleClasses }]) => ({
      virtualPath: relative(dir, virtualPath).split(sep).join('/'),
      styleClasses,
    })),
  });
  const configPath = join(dir, '.oxlintrc.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(derived));
  const childCwd = mirror(dir, configDir, cwd);
  mkdirSync(childCwd, { recursive: true });
  signal?.throwIfAborted();
  const { diagnostics } = await lintVirtualFiles(oxlint, {
    configPath,
    cwd: childCwd,
    files: [...sources.keys()],
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    findings: mapDiagnostics(diagnostics, {
      cwd: childCwd,
      root: dir,
      files: sources,
    }),
    files,
  };
}

function mirror(dir: string, base: string, path: string): string {
  const inside = relative(base, path);
  if (
    !isAbsolute(inside) &&
    inside !== '..' &&
    !inside.startsWith(`..${sep}`)
  ) {
    return join(dir, inside);
  }
  const { root } = parsePath(path);
  return join(
    dir,
    EXTERNAL,
    root.replaceAll(/[\\/:]/g, ''),
    path.slice(root.length),
  );
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareFindings(a: Finding, b: Finding): number {
  return (
    compareText(a.file, b.file) ||
    a.start.offset - b.start.offset ||
    compareText(a.rule, b.rule)
  );
}
