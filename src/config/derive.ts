import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';

import { ToolError } from '../errors.js';
import type { PluginEntry, PrintedConfig } from '../oxlint/commands.js';

export interface TailwindSettings {
  attributes: string[];
  attributePatterns: string[];
}

export interface DeriveInput {
  printed: PrintedConfig;
  configFile: string;
  cwd: string;
}

const PRIVATE_CALLEE = '__';
const TAILWIND_PLUGIN = /(^|[\\/])oxlint-tailwindcss([\\/]|$)/;

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

export function tailwindSettingsOf(printed: PrintedConfig): TailwindSettings {
  const settings = asRecord(printed.settings?.['tailwindcss']);
  return {
    attributes: strings(settings['attributes']),
    attributePatterns: strings(settings['attributePatterns']),
  };
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
  const byAlias = new Map<string | undefined, PluginEntry>();
  for (const entry of declaredPlugins(printed)) {
    const alias = typeof entry === 'string' ? undefined : entry.name;
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
  const { printed, configFile, cwd } = input;
  const configDir = dirname(configFile);
  const plugin = findPlugin(printed);
  const alias = typeof plugin === 'string' ? undefined : plugin.name;
  const prefix = `${alias ?? 'tailwindcss'}/`;
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
  const callees = strings(settings['callees']);
  settings['callees'] = [...callees, PRIVATE_CALLEE];

  const onlyTailwind = (rules: Json = {}): Json => {
    const kept: Json = {};
    for (const [name, value] of Object.entries(rules)) {
      if (!name.startsWith(prefix)) continue;
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
  const userOverrides = (printed.overrides ?? [])
    .map((override) => ({
      files: override.files.map(virtualGlob),
      rules: onlyTailwind(override.rules),
    }))
    .filter((override) => Object.keys(override.rules).length > 0);

  return {
    plugins: [],
    categories: {},
    jsPlugins: [
      alias === undefined ? pluginPath : { name: alias, specifier: pluginPath },
    ],
    settings: { tailwindcss: settings },
    rules,
    overrides: userOverrides,
    ignorePatterns: [],
  };
}
