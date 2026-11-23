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

import {
  configOptionsOf,
  deriveConfig,
  loadsTailwindPlugin,
  tailwindSettingsOf,
  type ConfigOptions,
  type TailwindSettings,
} from './config/derive.js';
import { ToolError } from './errors.js';
import { mapDiagnostics, type VirtualSource } from './map-diagnostics.js';
import {
  listLintedFiles,
  lintVirtualFiles,
  printConfig,
  type FileSelection,
  type PrintedConfig,
} from './oxlint/commands.js';
import {
  findConfigFile,
  resolveOxlint,
  type OxlintInstall,
} from './oxlint/resolve.js';
import { columnOf, type Position } from './positions.js';
import { createTempRoot, pruneStaleTempRoots } from './temp.js';
import type { Notice, Skip, VirtualizeResult } from './virtual/types.js';
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

export interface Located {
  line: number;
  column: number;
}

export interface FileReport {
  file: string;
  skipped: (Skip & Located)[];
  notices: (Notice & Located)[];
  notChecked?: string;
}

export interface SkippedConfig {
  config: string;
  files: number;
}

export interface LintResult {
  findings: Finding[];
  files: FileReport[];
  skippedConfigs: SkippedConfig[];
  warningOptions: { denyWarnings?: boolean; maxWarnings?: number };
}

interface GroupResult {
  findings: Finding[];
  files: FileReport[];
  skipped?: SkippedConfig;
}

interface GroupRun {
  oxlint: OxlintInstall;
  cwd: string;
  configFile: string;
  printedConfig: (configFile: string) => Promise<PrintedConfig>;
  respectEslintDisableDirectives: boolean | undefined;
  files: readonly string[];
  dir: string;
  signal: AbortSignal | undefined;
}

const EXTERNAL = '_external';
const VUE_PARSE_ERROR = 'Vue could not parse this file.';
const ISSUES_URL =
  'https://github.com/quentinjuarez/oxlint-tailwindcss-vue/issues';

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
  const printedConfig = configPrinter(oxlint, cwd);
  const { respectEslintDisableDirectives, ...warningOptions }: ConfigOptions =
    rootConfig === undefined
      ? {}
      : configOptionsOf(await printedConfig(rootConfig));
  signal?.throwIfAborted();
  if (listed.length === 0)
    return { findings: [], files: [], skippedConfigs: [], warningOptions };
  const groups = groupByConfig([...new Set(listed)], userConfig);

  const temp = createTempRoot();
  try {
    const findings: Finding[] = [];
    const files: FileReport[] = [];
    const skippedConfigs: SkippedConfig[] = [];
    for (const [index, [configFile, groupFiles]] of [...groups].entries()) {
      // oxlint already uses every core; groups run one after the other.
      // oxlint-disable-next-line no-await-in-loop
      const result = await lintGroup({
        oxlint,
        cwd,
        configFile,
        printedConfig,
        respectEslintDisableDirectives,
        files: groupFiles,
        dir: join(temp.path, String(index)),
        signal,
      });
      findings.push(...result.findings);
      files.push(...result.files);
      if (result.skipped !== undefined) skippedConfigs.push(result.skipped);
    }
    if (skippedConfigs.length === groups.size)
      throw noPluginError(skippedConfigs);
    return {
      findings: findings.toSorted(compareFindings),
      files: files.toSorted((a, b) => compareText(a.file, b.file)),
      skippedConfigs: skippedConfigs.toSorted((a, b) =>
        compareText(a.config, b.config),
      ),
      warningOptions,
    };
  } finally {
    temp.remove();
  }
}

function configPrinter(
  oxlint: OxlintInstall,
  cwd: string,
): (configFile: string) => Promise<PrintedConfig> {
  const printed = new Map<string, Promise<PrintedConfig>>();
  return (configFile) => {
    const cached = printed.get(configFile);
    if (cached !== undefined) return cached;
    const config = printConfig(oxlint, cwd, configFile);
    printed.set(configFile, config);
    return config;
  };
}

function noPluginError(skipped: readonly SkippedConfig[]): ToolError {
  const hint = 'Add "jsPlugins": ["oxlint-tailwindcss"] to your oxlint config.';
  const [only] = skipped;
  if (skipped.length === 1 && only !== undefined) {
    return new ToolError(
      `oxlint-tailwindcss is not in the jsPlugins of your oxlint config: ${only.config}`,
      hint,
    );
  }
  return new ToolError(
    `oxlint-tailwindcss is not in the jsPlugins of any oxlint config:\n${skipped.map(({ config }) => `  ${config}`).join('\n')}`,
    hint,
  );
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

async function lintGroup(group: GroupRun): Promise<GroupResult> {
  const { oxlint, cwd, configFile, dir, signal } = group;
  const printed = await group.printedConfig(configFile);
  signal?.throwIfAborted();
  if (!loadsTailwindPlugin(printed)) {
    return {
      findings: [],
      files: [],
      skipped: { config: configFile, files: group.files.length },
    };
  }
  const configDir = dirname(configFile);
  const settings = tailwindSettingsOf(printed);
  const files: FileReport[] = [];
  const sources = new Map<string, VirtualSource & { styleClasses: string[] }>();
  for (const file of group.files) {
    const source = readSource(file);
    const { code, skipped, notices, styleClasses } = virtualizeFile(
      file,
      source,
      settings,
    );
    const locate = locator(source);
    const report: FileReport = {
      file,
      skipped: skipped.map((skip) =>
        Object.assign({}, skip, locate(skip.span.start)),
      ),
      notices: notices.map((notice) =>
        Object.assign({}, notice, locate(notice.span.start)),
      ),
    };
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
    respectEslintDisableDirectives: group.respectEslintDisableDirectives,
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
      themes: { cwd, paths: absolutePathsIn(derived) },
    }),
    files,
  };
}

function absolutePathsIn(value: unknown): string[] {
  if (typeof value === 'string') return isAbsolute(value) ? [value] : [];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(absolutePathsIn);
}

function readSource(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    const message = `Cannot read ${file}: ${messageOf(error)}`;
    throw isMissingFile(error)
      ? new ToolError(
          message,
          'If the file still exists, a name in its path contains a backslash or a line break, which oxlint-tailwindcss-vue does not support.',
        )
      : new ToolError(message);
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function virtualizeFile(
  file: string,
  source: string,
  settings: TailwindSettings,
): VirtualizeResult {
  try {
    return virtualize(source, settings);
  } catch (error) {
    throw new ToolError(
      `Unexpected error on ${file}: ${messageOf(error)}`,
      `This is a bug in oxlint-tailwindcss-vue. Report it with this file at ${ISSUES_URL}`,
      { cause: error },
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function locator(source: string): (offset: number) => Located {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code === 10 || (code === 13 && source.charCodeAt(index + 1) !== 10)) {
      lineStarts.push(index + 1);
    }
  }
  return (offset) => {
    let line = lineStarts.findLastIndex((start) => start <= offset);
    line = Math.max(line, 0);
    return {
      line: line + 1,
      column: columnOf(source, lineStarts[line] as number, offset),
    };
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
