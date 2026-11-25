import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';

import { ToolError } from '../errors.js';
import type { PluginEntry, PrintedConfig } from '../oxlint/commands.js';
import { CLASS_CALLEE, OBJECT_VALUES_CALLEE } from '../virtual/call.js';

export interface TailwindSettings {
  attributes: string[];
  attributePatterns: string[];
}

export interface ConfigOptions {
  denyWarnings?: boolean;
  maxWarnings?: number;
  respectEslintDisableDirectives?: boolean;
}

export interface DeriveInput {
  printed: PrintedConfig;
  configFile: string;
  cwd: string;
  respectEslintDisableDirectives?: boolean | undefined;
  fix?: boolean;
}

const TAILWIND_PLUGIN = /(^|[\\/])oxlint-tailwindcss([\\/]|$)/;
const BARE_ENTRY_ALIAS = 'tailwindcss';

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function specifierOf(entry: PluginEntry): string {
  return typeof entry === 'string' ? entry : entry.specifier;
}

function aliasOf(entry: PluginEntry): string {
  return typeof entry === 'string' ? BARE_ENTRY_ALIAS : entry.name;
}

export function tailwindSettingsOf(printed: PrintedConfig): TailwindSettings {
  const settings = asRecord(printed.settings?.['tailwindcss']);
  return {
    attributes: strings(settings['attributes']),
    attributePatterns: strings(settings['attributePatterns']),
  };
}

export function configOptionsOf(printed: PrintedConfig): ConfigOptions {
  const { denyWarnings, maxWarnings, respectEslintDisableDirectives } =
    asRecord(printed.options);
  const options: ConfigOptions = {};
  if (typeof denyWarnings === 'boolean') options.denyWarnings = denyWarnings;
  if (
    typeof maxWarnings === 'number' &&
    Number.isInteger(maxWarnings) &&
    maxWarnings >= 0
  ) {
    options.maxWarnings = maxWarnings;
  }
  if (typeof respectEslintDisableDirectives === 'boolean') {
    options.respectEslintDisableDirectives = respectEslintDisableDirectives;
  }
  return options;
}

function declaredPlugins(printed: PrintedConfig): PluginEntry[] {
  return [
    ...(printed.jsPlugins ?? []),
    ...(printed.overrides ?? []).flatMap(
      (override) => override.jsPlugins ?? [],
    ),
  ].filter((plugin) => TAILWIND_PLUGIN.test(specifierOf(plugin)));
}

export function loadsTailwindPlugin(printed: PrintedConfig): boolean {
  return declaredPlugins(printed).length > 0;
}

function findPlugin(printed: PrintedConfig): PluginEntry {
  const byAlias = new Map<string, PluginEntry>();
  for (const entry of declaredPlugins(printed)) {
    const alias = aliasOf(entry);
    if (!byAlias.has(alias)) byAlias.set(alias, entry);
  }
  const [entry] = byAlias.values();
  if (byAlias.size > 1) {
    throw new ToolError(
      `oxlint-tailwindcss is declared with ${byAlias.size} different aliases: ${[...byAlias.values()].map((plugin) => JSON.stringify(plugin)).join(', ')}`,
      'Declare oxlint-tailwindcss once in your oxlint config, with a single alias.',
    );
  }
  if (entry === undefined) {
    throw new ToolError(
      'oxlint-tailwindcss is not in the jsPlugins of your oxlint config.',
      'Add "oxlint-tailwindcss" to jsPlugins in your oxlint config.',
    );
  }
  return entry;
}

function resolvePluginPath(specifier: string, configFile: string): string {
  if (isAbsolute(specifier)) return specifier;
  if (specifier.startsWith('.')) return resolve(dirname(configFile), specifier);
  try {
    const require = createRequire(configFile);
    const { tailwindcss } = require('oxlint-tailwindcss/config') as {
      tailwindcss: () => { jsPlugins: string[] };
    };
    const [path] = tailwindcss().jsPlugins;
    if (path === undefined) throw new Error('no plugin path');
    return path;
  } catch {
    throw new ToolError(
      `Cannot resolve oxlint-tailwindcss from ${dirname(configFile)}.`,
      'Install oxlint-tailwindcss (>=1.17.2) in your project, and list it in jsPlugins.',
    );
  }
}

function virtualGlob(glob: string): string {
  // oxlint 1.94 stops recursing on a final `**` followed by `.ts`
  // (`src/legacy/**.ts` misses `src/legacy/x/Deep.vue.ts`).
  return glob.endsWith('**') || glob.endsWith('/')
    ? `${glob}/*.ts`
    : `${glob}.ts`;
}

function globsOf(value: unknown): string[] {
  return typeof value === 'string' ? [value] : strings(value);
}

export function deriveConfig(input: DeriveInput): Record<string, unknown> {
  const { printed, configFile, cwd, respectEslintDisableDirectives, fix } =
    input;
  const configDir = dirname(configFile);
  const plugin = findPlugin(printed);
  const prefix = `${aliasOf(plugin)}/`;
  const lineWrapping = `${prefix}enforce-consistent-line-wrapping`;
  const pluginPath = resolvePluginPath(specifierOf(plugin), configFile);

  const absolute = (path: string): string => {
    for (const base of [configDir, cwd]) {
      const candidate = resolve(base, path);
      if (existsSync(candidate)) return candidate;
    }
    throw new ToolError(
      `Tailwind entry point not found: ${path}`,
      `Checked ${resolve(configDir, path)} and ${resolve(cwd, path)}. Fix settings.tailwindcss.entryPoint (or the rule option) in your oxlint config.`,
    );
  };

  const mapEntryPoint = (entryPoint: unknown): unknown => {
    if (typeof entryPoint === 'string') return absolute(entryPoint);
    if (!Array.isArray(entryPoint)) return entryPoint;
    return entryPoint.map((mapping: unknown) => {
      const copy = Object.assign({}, asRecord(mapping));
      copy['files'] = globsOf(copy['files']).map(virtualGlob);
      copy['use'] = absolute(String(copy['use']));
      return copy;
    });
  };

  const settings = structuredClone(asRecord(printed.settings?.['tailwindcss']));
  if (settings['entryPoint'] !== undefined) {
    settings['entryPoint'] = mapEntryPoint(settings['entryPoint']);
  }
  settings['callees'] = [...strings(settings['callees']), CLASS_CALLEE];
  settings['calleeExtractors'] = {
    ...asRecord(settings['calleeExtractors']),
    [OBJECT_VALUES_CALLEE]: 'cva',
  };

  const onlyTailwind = (rules: Json = {}): Json => {
    const kept: Json = {};
    for (const [name, value] of Object.entries(rules)) {
      if (!name.startsWith(prefix) || (fix === true && name === lineWrapping))
        continue;
      if (Array.isArray(value)) {
        const [severity, options, ...rest] = value as unknown[];
        const optionBag = asRecord(options);
        kept[name] =
          optionBag['entryPoint'] === undefined
            ? value
            : [
                severity,
                {
                  ...optionBag,
                  entryPoint: mapEntryPoint(optionBag['entryPoint']),
                },
                ...rest,
              ];
      } else {
        kept[name] = value;
      }
    }
    return kept;
  };

  const rules = onlyTailwind(printed.rules);
  const userOverrides = (printed.overrides ?? []).flatMap((override) => {
    const overrideRules = onlyTailwind(override.rules);
    if (Object.keys(overrideRules).length === 0) return [];
    const derived: Json = { files: override.files.map(virtualGlob) };
    if (override.excludeFiles !== undefined) {
      derived['excludeFiles'] = override.excludeFiles.map(virtualGlob);
    }
    derived['rules'] = overrideRules;
    return [derived];
  });

  return {
    plugins: [],
    categories: {},
    jsPlugins: [
      typeof plugin === 'string'
        ? pluginPath
        : { name: plugin.name, specifier: pluginPath },
    ],
    settings: { tailwindcss: settings },
    rules,
    overrides: userOverrides,
    ignorePatterns: [],
    ...(respectEslintDisableDirectives === undefined
      ? {}
      : { options: { respectEslintDisableDirectives } }),
  };
}
