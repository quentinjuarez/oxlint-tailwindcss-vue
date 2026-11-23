import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  configOptionsOf,
  deriveConfig,
  tailwindSettingsOf,
} from '../../src/config/derive.js';
import { ToolError } from '../../src/errors.js';
import { printConfig } from '../../src/oxlint/commands.js';
import { resolveOxlint } from '../../src/oxlint/resolve.js';

const projects = fileURLToPath(
  new URL('../fixtures/projects/', import.meta.url),
);
const oxlint = resolveOxlint([process.cwd()]);

async function derive(project: string): Promise<Record<string, any>> {
  const dir = join(projects, project);
  const configFile = join(
    dir,
    project === 'alias' ? 'alias.oxlintrc.json' : '.oxlintrc.json',
  );
  const printed = await printConfig(oxlint, dir, configFile);
  return deriveConfig({ printed, configFile, cwd: dir });
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
        files: ['src/legacy/**/*.vue.ts'],
        use: join(dirMapping, 'src', 'legacy.css'),
      },
      {
        files: ['src/**/*.vue.ts', 'src/**/*.ts.ts'],
        use: join(dirMapping, 'src', 'style.css'),
      },
    ]);
  });

  it('adds the private callees and keeps the user callees', async () => {
    const basic = (await derive('basic')).settings.tailwindcss;
    expect(basic.callees).toEqual(['__']);
    expect(basic.calleeExtractors).toEqual({ ___: 'cva' });
    expect((await derive('alias')).settings.tailwindcss.callees).toEqual([
      'cva',
      '__',
    ]);
  });

  it('keeps the user callee extractors next to ___', () => {
    const dir = join(projects, 'basic');
    const extractorsOf = (calleeExtractors: unknown) =>
      (
        deriveConfig({
          printed: {
            jsPlugins: ['oxlint-tailwindcss'],
            settings: { tailwindcss: { calleeExtractors } },
          },
          configFile: join(dir, '.oxlintrc.json'),
          cwd: dir,
        }) as Record<string, any>
      )['settings'].tailwindcss.calleeExtractors;
    expect(extractorsOf({ styles: 'tv', ___: 'flat' })).toEqual({
      styles: 'tv',
      ___: 'cva',
    });
    expect(extractorsOf(['tv'])).toEqual({ ___: 'cva' });
  });

  it('writes only the user overrides, with no allowlist override', async () => {
    const derived = await derive('alias');
    expect(derived.overrides).toEqual([
      {
        files: ['src/**/*.vue.ts'],
        rules: { 'tw/no-duplicate-classes': 'warn' },
      },
    ]);
    expect(derived.rules['tw/no-unknown-classes']).toEqual([
      'deny',
      { allowlist: ['legacy-card'] },
    ]);
  });

  it('appends .ts to every user glob, or /*.ts after a final ** or /', () => {
    const dir = join(projects, 'basic');
    const style = join(dir, 'src', 'style.css');
    const derived = deriveConfig({
      printed: {
        jsPlugins: ['oxlint-tailwindcss'],
        settings: {
          tailwindcss: {
            entryPoint: [
              { files: ['src/**/*.{vue,ts}'], use: 'src/style.css' },
              { files: 'src/legacy/**', use: 'src/style.css' },
            ],
          },
        },
        rules: { 'tailwindcss/no-unknown-classes': 'deny' },
        overrides: [
          {
            files: [
              'src/**/*.vue',
              '**/*.{js,vue}',
              '**/*.ts',
              'src/legacy/**',
              'src/old/',
              '**',
            ],
            rules: { 'tailwindcss/no-unknown-classes': 'off' },
          },
        ],
      },
      configFile: join(dir, '.oxlintrc.json'),
      cwd: dir,
    }) as Record<string, any>;
    expect(derived.overrides).toEqual([
      {
        files: [
          'src/**/*.vue.ts',
          '**/*.{js,vue}.ts',
          '**/*.ts.ts',
          'src/legacy/**/*.ts',
          'src/old//*.ts',
          '**/*.ts',
        ],
        rules: { 'tailwindcss/no-unknown-classes': 'off' },
      },
    ]);
    expect(derived.settings.tailwindcss.entryPoint).toEqual([
      { files: ['src/**/*.{vue,ts}.ts'], use: style },
      { files: ['src/legacy/**/*.ts'], use: style },
    ]);
  });

  it('maps the excludeFiles of an override like its files', () => {
    const dir = join(projects, 'basic');
    const derived = deriveConfig({
      printed: {
        jsPlugins: ['oxlint-tailwindcss'],
        overrides: [
          {
            files: ['src/**'],
            excludeFiles: ['src/legacy/**', '**/*.gen.vue', '**/*.ts'],
            rules: { 'tailwindcss/no-unknown-classes': 'off' },
          },
          {
            files: ['**/*.vue'],
            rules: { 'tailwindcss/no-duplicate-classes': 'warn' },
          },
        ],
      },
      configFile: join(dir, '.oxlintrc.json'),
      cwd: dir,
    }) as Record<string, any>;
    expect(derived.overrides).toEqual([
      {
        files: ['src/**/*.ts'],
        excludeFiles: ['src/legacy/**/*.ts', '**/*.gen.vue.ts', '**/*.ts.ts'],
        rules: { 'tailwindcss/no-unknown-classes': 'off' },
      },
      {
        files: ['**/*.vue.ts'],
        rules: { 'tailwindcss/no-duplicate-classes': 'warn' },
      },
    ]);
    expect(derived.overrides[1]).not.toHaveProperty('excludeFiles');
  });

  it('writes the given respectEslintDisableDirectives, and no other option', () => {
    const dir = join(projects, 'basic');
    const deriveWith = (respectEslintDisableDirectives?: boolean) =>
      deriveConfig({
        printed: {
          jsPlugins: ['oxlint-tailwindcss'],
          options: {
            denyWarnings: true,
            maxWarnings: 2,
            respectEslintDisableDirectives: true,
            typeAware: true,
          },
        },
        configFile: join(dir, '.oxlintrc.json'),
        cwd: dir,
        respectEslintDisableDirectives,
      });
    expect(deriveWith(false)['options']).toEqual({
      respectEslintDisableDirectives: false,
    });
    expect(deriveWith(true)['options']).toEqual({
      respectEslintDisableDirectives: true,
    });
    expect(deriveWith()).not.toHaveProperty('options');
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
    });
    expect((derived.settings as any).tailwindcss.entryPoint).toBe(
      join(dir, 'src', 'style.css'),
    );
  });
});

describe('deriveConfig on awkward input', () => {
  const dir = join(projects, 'basic');
  const configFile = join(dir, '.oxlintrc.json');
  const jsPlugins = ['oxlint-tailwindcss'];

  it('maps a rule option entryPoint given as a mapping array', () => {
    const derived = deriveConfig({
      printed: {
        jsPlugins,
        rules: {
          'tailwindcss/no-unknown-classes': [
            'deny',
            {
              entryPoint: [{ files: ['src/**/*.vue'], use: 'src/style.css' }],
            },
          ],
        },
      },
      configFile,
      cwd: dir,
    });
    expect(derived['rules'] as Record<string, unknown>).toEqual({
      'tailwindcss/no-unknown-classes': [
        'deny',
        {
          entryPoint: [
            {
              files: ['src/**/*.vue.ts'],
              use: join(dir, 'src', 'style.css'),
            },
          ],
        },
      ],
    });
    expect(() =>
      deriveConfig({
        printed: {
          jsPlugins,
          rules: {
            'tailwindcss/no-unknown-classes': [
              'deny',
              { entryPoint: [{ files: [], use: 'src/nope.css' }] },
            ],
          },
        },
        configFile,
        cwd: dir,
      }),
    ).toThrow(/nope\.css/);
  });

  it('counts the same alias declared in an override as one plugin', () => {
    const derived = deriveConfig({
      printed: {
        jsPlugins: [{ name: 'tw', specifier: 'oxlint-tailwindcss' }],
        overrides: [
          {
            files: ['**/*.vue'],
            jsPlugins: [{ name: 'tw', specifier: 'oxlint-tailwindcss' }],
            rules: { 'tw/no-unknown-classes': 'deny' },
          },
        ],
      },
      configFile,
      cwd: dir,
    });
    expect(derived['jsPlugins']).toHaveLength(1);
    expect(derived['plugins']).toEqual([]);
    expect(derived['categories']).toEqual({});
  });

  it('counts a bare entry and an entry aliased tailwindcss as one declaration', () => {
    const derived = deriveConfig({
      printed: {
        jsPlugins: [
          'oxlint-tailwindcss',
          { name: 'tailwindcss', specifier: 'oxlint-tailwindcss' },
        ],
        overrides: [
          {
            files: ['**/*.vue'],
            jsPlugins: [
              { name: 'tailwindcss', specifier: 'oxlint-tailwindcss' },
            ],
          },
        ],
        rules: { 'tailwindcss/no-unknown-classes': 'deny' },
      },
      configFile,
      cwd: dir,
    });
    expect(derived['jsPlugins']).toHaveLength(1);
    expect(Object.keys(derived['rules'] as object)).toEqual([
      'tailwindcss/no-unknown-classes',
    ]);
  });

  it('refuses oxlint-tailwindcss listed twice and names the entries', () => {
    const run = () =>
      deriveConfig({
        printed: {
          jsPlugins: [
            'oxlint-tailwindcss',
            { name: 'tw', specifier: 'oxlint-tailwindcss' },
          ],
        },
        configFile,
        cwd: dir,
      });
    expect(run).toThrow(ToolError);
    expect(run).toThrow(/2 different aliases.*"name":"tw"/);
  });

  it('refuses different aliases across the top level and an override', () => {
    const run = () =>
      deriveConfig({
        printed: {
          jsPlugins: ['oxlint-tailwindcss'],
          overrides: [
            {
              files: ['**/*.vue'],
              jsPlugins: [{ name: 'tw', specifier: 'oxlint-tailwindcss' }],
            },
          ],
        },
        configFile,
        cwd: dir,
      });
    expect(run).toThrow(/2 different aliases/);
    expect(() => run()).toThrow(
      expect.objectContaining({ hint: expect.stringContaining('once') }),
    );
  });
});

describe('configOptionsOf', () => {
  it('reads the warning options and respectEslintDisableDirectives', () => {
    expect(
      configOptionsOf({
        options: {
          denyWarnings: true,
          maxWarnings: 0,
          respectEslintDisableDirectives: false,
          typeAware: true,
        },
      }),
    ).toEqual({
      denyWarnings: true,
      maxWarnings: 0,
      respectEslintDisableDirectives: false,
    });
  });

  it('ignores a missing options object and values of the wrong type', () => {
    expect(configOptionsOf({})).toEqual({});
    expect(
      configOptionsOf({
        options: {
          denyWarnings: 'yes',
          maxWarnings: 1.5,
          respectEslintDisableDirectives: 0,
        },
      }),
    ).toEqual({});
    expect(configOptionsOf({ options: { maxWarnings: -1 } })).toEqual({});
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
