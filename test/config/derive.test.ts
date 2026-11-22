import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  deriveConfig,
  tailwindSettingsOf,
  type DeriveInput,
} from '../../src/config/derive.js';
import { ToolError } from '../../src/errors.js';
import { printConfig } from '../../src/oxlint/commands.js';
import { resolveOxlint } from '../../src/oxlint/resolve.js';

const projects = fileURLToPath(
  new URL('../fixtures/projects/', import.meta.url),
);
const oxlint = resolveOxlint([process.cwd()]);

async function derive(
  project: string,
  files: DeriveInput['files'] = [],
): Promise<Record<string, any>> {
  const dir = join(projects, project);
  const configFile = join(
    dir,
    project === 'alias' ? 'alias.oxlintrc.json' : '.oxlintrc.json',
  );
  const printed = await printConfig(oxlint, dir, configFile);
  return deriveConfig({ printed, configFile, cwd: dir, files });
}

describe('deriveConfig', () => {
  it('keeps only the Tailwind rules and turns native plugins off', async () => {
    const derived = await derive('basic');
    expect(derived.plugins).toEqual([]);
    expect(derived.categories).toEqual({});
    expect(derived.ignorePatterns).toEqual([]);
    expect(Object.keys(derived.rules).toSorted()).toEqual([
      'tailwindcss/no-conflicting-classes',
      'tailwindcss/no-duplicate-classes',
      'tailwindcss/no-unknown-classes',
    ]);
    expect(JSON.stringify(derived)).not.toContain('no-debugger');
  });

  it('resolves the plugin to the absolute path oxlint loads', async () => {
    const [plugin] = (await derive('basic')).jsPlugins;
    expect(plugin).toMatch(/oxlint-tailwindcss[\\/]dist[\\/]index\.mjs$/);
    expect(isAbsolute(plugin)).toBe(true);

    const alias = await derive('alias');
    expect(alias.jsPlugins).toHaveLength(1);
    expect(alias.jsPlugins[0].name).toBe('tw');
    expect(alias.jsPlugins[0].specifier).toBe(plugin);
    expect(Object.keys(alias.rules)).toEqual(['tw/no-unknown-classes']);
  });

  it('makes entryPoint absolute, in settings and in rule options', async () => {
    const derived = await derive('basic');
    expect(derived.settings.tailwindcss.entryPoint).toBe(
      join(projects, 'basic', 'src', 'style.css'),
    );

    const dir = join(projects, 'basic');
    const configFile = join(dir, '.oxlintrc.json');
    const withOption = deriveConfig({
      printed: {
        jsPlugins: ['oxlint-tailwindcss'],
        rules: {
          'tailwindcss/no-unknown-classes': [
            'deny',
            { entryPoint: 'src/style.css' },
          ],
        },
      },
      configFile,
      cwd: dir,
      files: [],
    });
    expect(
      (withOption as Record<string, any>)['rules'][
        'tailwindcss/no-unknown-classes'
      ],
    ).toEqual(['deny', { entryPoint: join(dir, 'src', 'style.css') }]);

    const mapping = await derive('mapping');
    const dirMapping = join(projects, 'mapping');
    expect(mapping.settings.tailwindcss.entryPoint).toEqual([
      {
        files: ['src/legacy/**/*.vue', 'src/legacy/**/*.vue.ts'],
        use: join(dirMapping, 'src', 'legacy.css'),
      },
      {
        files: ['src/**/*.vue', 'src/**/*.vue.ts', 'src/**/*.ts'],
        use: join(dirMapping, 'src', 'style.css'),
      },
    ]);
  });

  it('adds the private callee and keeps the user callees', async () => {
    expect((await derive('basic')).settings.tailwindcss.callees).toEqual([
      '__',
    ]);
    expect((await derive('alias')).settings.tailwindcss.callees).toEqual([
      'cva',
      '__',
    ]);
  });

  it('puts the style allowlist overrides first, then the user overrides', async () => {
    const derived = await derive('alias', [
      { virtualPath: 'src/App.vue.ts', styleClasses: ['card', 'legacy-card'] },
      { virtualPath: 'src/Plain.vue.ts', styleClasses: [] },
    ]);
    expect(derived.overrides).toEqual([
      {
        files: ['src/App.vue.ts'],
        rules: {
          'tw/no-unknown-classes': [
            'deny',
            { allowlist: ['legacy-card', 'card'] },
          ],
        },
      },
      {
        files: ['src/**/*.vue', 'src/**/*.vue.ts'],
        rules: { 'tw/no-duplicate-classes': 'warn' },
      },
    ]);

    const basic = await derive('basic', [
      { virtualPath: 'src/App.vue.ts', styleClasses: ['card'] },
    ]);
    expect(basic.overrides[0]).toEqual({
      files: ['src/App.vue.ts'],
      rules: {
        'tailwindcss/no-unknown-classes': ['deny', { allowlist: ['card'] }],
      },
    });
    expect(basic.overrides[1].files).toEqual([
      'src/legacy/**/*.vue',
      'src/legacy/**/*.vue.ts',
    ]);
  });

  it('writes no allowlist override when no-unknown-classes is off or absent', async () => {
    const dir = join(projects, 'basic');
    const configFile = join(dir, '.oxlintrc.json');
    const files = [{ virtualPath: 'src/App.vue.ts', styleClasses: ['card'] }];
    for (const rules of [
      { 'tailwindcss/no-unknown-classes': 'allow' },
      { 'tailwindcss/no-duplicate-classes': 'deny' },
    ]) {
      const derived = deriveConfig({
        printed: { jsPlugins: ['oxlint-tailwindcss'], rules },
        configFile,
        cwd: dir,
        files,
      });
      expect(derived.overrides).toEqual([]);
    }
  });

  it('refuses a config without oxlint-tailwindcss', async () => {
    const error = await derive('no-plugin').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).hint).toContain('jsPlugins');
  });

  it('refuses a missing entry point', () => {
    const dir = join(projects, 'basic');
    const run = () =>
      deriveConfig({
        printed: {
          jsPlugins: ['oxlint-tailwindcss'],
          settings: { tailwindcss: { entryPoint: 'src/missing.css' } },
        },
        configFile: join(dir, '.oxlintrc.json'),
        cwd: dir,
        files: [],
      });
    expect(run).toThrow(ToolError);
    expect(run).toThrow(/missing\.css/);
  });

  it('resolves relative and absolute plugin specifiers', () => {
    const dir = join(projects, 'basic');
    const configFile = join(dir, '.oxlintrc.json');
    const make = (specifier: string) =>
      deriveConfig({
        printed: { jsPlugins: [{ name: 'tw', specifier }] },
        configFile,
        cwd: dir,
        files: [],
      }).jsPlugins as { specifier: string }[];
    expect(make('./vendor/oxlint-tailwindcss/index.mjs')[0]?.specifier).toBe(
      join(dir, 'vendor', 'oxlint-tailwindcss', 'index.mjs'),
    );
    const absolute = join(dir, 'x', 'oxlint-tailwindcss', 'index.mjs');
    expect(make(absolute)[0]?.specifier).toBe(absolute);
  });

  it('falls back to the working directory for a relative entry point', () => {
    const dir = join(projects, 'basic');
    const derived = deriveConfig({
      printed: {
        jsPlugins: ['oxlint-tailwindcss'],
        settings: { tailwindcss: { entryPoint: 'style.css' } },
      },
      configFile: join(projects, 'alias', 'alias.oxlintrc.json'),
      cwd: join(dir, 'src'),
      files: [],
    });
    expect((derived.settings as any).tailwindcss.entryPoint).toBe(
      join(dir, 'src', 'style.css'),
    );
  });
});

describe('tailwindSettingsOf', () => {
  it('reads attributes and attributePatterns, defaulting to empty lists', () => {
    expect(
      tailwindSettingsOf({
        settings: {
          tailwindcss: { attributes: ['tw', 3], attributePatterns: ['^ui-'] },
        },
      }),
    ).toEqual({ attributes: ['tw'], attributePatterns: ['^ui-'] });
    expect(tailwindSettingsOf({})).toEqual({
      attributes: [],
      attributePatterns: [],
    });
    expect(tailwindSettingsOf({ settings: { tailwindcss: 1 } })).toEqual({
      attributes: [],
      attributePatterns: [],
    });
  });
});
