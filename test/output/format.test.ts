import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { describe, expect, it } from 'vitest';

import type { Finding, LintResult } from '../../src/lint.js';
import { exitCodeFor, formatReport } from '../../src/output/format.js';
import type { Position } from '../../src/positions.js';

const cwd = join('/', 'work', 'project');
const app = join(cwd, 'src', 'App.vue');
const card = join(cwd, 'src', 'Card.vue');
const broken = join(cwd, 'src', 'Broken.vue');

function at(line: number, column: number, offset: number): Position {
  return {
    line,
    column,
    byteColumn: column + 2,
    offset,
    byteOffset: offset + 2,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: app,
    rule: 'tailwindcss/no-unknown-classes',
    severity: 'error',
    message: '"x" is not a valid Tailwind class.',
    start: at(3, 14, 40),
    end: at(3, 15, 41),
    ...overrides,
  };
}

const result: LintResult = {
  skippedConfigs: [],
  warningOptions: {},
  findings: [
    finding(),
    finding({
      rule: 'tailwindcss/no-duplicate-classes',
      severity: 'warning',
      message: '"p-1" is duplicated.',
      start: at(5, 3, 70),
      end: at(5, 6, 73),
    }),
    finding({
      file: card,
      severity: 'error',
      start: at(2, 9, 20),
      end: at(2, 10, 21),
    }),
  ],
  files: [
    {
      file: app,
      skipped: [
        {
          code: 'entity',
          attribute: 'class',
          span: { start: 60, end: 80 },
          line: 5,
          column: 3,
        },
      ],
      notices: [
        {
          code: 'unquoted-key',
          key: 'active',
          span: { start: 90, end: 96 },
          line: 7,
          column: 20,
        },
      ],
    },
    { file: card, skipped: [], notices: [] },
    { file: join(cwd, 'src', 'Clean.vue'), skipped: [], notices: [] },
  ],
};

const plain = { cwd, quiet: false, debug: false, color: false };

describe('default format', () => {
  it('prints one line per finding then a summary', () => {
    expect(formatReport(result, 'default', plain)).toBe(
      [
        'src/App.vue:3:14 error tailwindcss/no-unknown-classes "x" is not a valid Tailwind class.',
        'src/App.vue:5:3 warning tailwindcss/no-duplicate-classes "p-1" is duplicated.',
        'src/Card.vue:2:9 error tailwindcss/no-unknown-classes "x" is not a valid Tailwind class.',
        '',
        '2 errors, 1 warning in 2 files',
        '',
      ].join('\n'),
    );
  });

  it('uses singular nouns for one finding in one file', () => {
    const one: LintResult = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [finding()],
      files: result.files,
    };
    expect(formatReport(one, 'default', plain)).toContain(
      '1 error, 0 warnings in 1 file\n',
    );
  });

  it('says so when nothing was found', () => {
    expect(
      formatReport(
        {
          skippedConfigs: [],
          warningOptions: {},
          findings: [],
          files: result.files,
        },
        'default',
        plain,
      ),
    ).toBe('No problems found in 3 files.\n');
    expect(
      formatReport(
        {
          skippedConfigs: [],
          warningOptions: {},
          findings: [],
          files: result.files.slice(0, 1),
        },
        'default',
        plain,
      ),
    ).toBe('No problems found in 1 file.\n');
  });

  it('adds skips and notices with --debug', () => {
    const output = formatReport(result, 'default', { ...plain, debug: true });
    expect(output).toContain('src/App.vue:5:3 skipped entity class\n');
    expect(output).toContain('src/App.vue:7:20 notice unquoted-key active\n');
    expect(output.endsWith('2 errors, 1 warning in 2 files\n')).toBe(true);
  });

  it('adds refused fixes with --debug', () => {
    const fixed: LintResult = {
      ...result,
      files: [
        {
          file: app,
          skipped: [],
          notices: [],
          fixed: true,
          refusedFixes: [{ code: 'unsafe-value', line: 2, column: 6 }],
        },
      ],
    };
    expect(formatReport(fixed, 'default', { ...plain, debug: true })).toContain(
      'src/App.vue:2:6 fix refused unsafe-value\n',
    );
    expect(formatReport(fixed, 'default', plain)).not.toContain('fix refused');
  });

  it('lists configs without the plugin with --debug', () => {
    const skipped: LintResult = {
      ...result,
      skippedConfigs: [
        { config: join(cwd, 'packages', 'b', '.oxlintrc.json'), files: 2 },
        { config: join(cwd, '.oxlintrc.json'), files: 1 },
      ],
    };
    const output = formatReport(skipped, 'default', { ...plain, debug: true });
    expect(output).toContain(
      'skipped 2 .vue files: packages/b/.oxlintrc.json does not load oxlint-tailwindcss\n',
    );
    expect(output).toContain(
      'skipped 1 .vue file: .oxlintrc.json does not load oxlint-tailwindcss\n',
    );
    expect(formatReport(skipped, 'default', plain)).not.toContain('skipped');
  });

  it('colors only when asked', () => {
    expect(formatReport(result, 'default', plain)).not.toContain('\u001B[');
    const colored = formatReport(result, 'default', { ...plain, color: true });
    expect(colored).toContain('\u001B[');
    expect(stripVTControlCharacters(colored)).toBe(
      formatReport(result, 'default', plain),
    );
  });

  it('lists files that were not checked', () => {
    const unchecked: LintResult = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [],
      files: [
        ...result.files,
        {
          file: broken,
          skipped: [],
          notices: [],
          notChecked: 'Vue could not parse this file.',
        },
      ],
    };
    expect(formatReport(unchecked, 'default', plain)).toBe(
      [
        'src/Broken.vue not checked: Vue could not parse this file.',
        '',
        '0 errors, 0 warnings, 1 file not checked',
        '',
      ].join('\n'),
    );
  });

  it('drops warnings with --quiet but keeps files that were not checked', () => {
    const warningsOnly: LintResult = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [result.findings[1] as Finding],
      files: [
        ...result.files,
        { file: broken, skipped: [], notices: [], notChecked: 'No.' },
      ],
    };
    const output = formatReport(warningsOnly, 'default', {
      ...plain,
      quiet: true,
    });
    expect(output).not.toContain('warning');
    expect(output).toContain('src/Broken.vue not checked: No.');
    expect(
      formatReport(result, 'default', { ...plain, quiet: true }),
    ).toContain('2 errors in 2 files');
  });
});

describe('json format', () => {
  it("follows oxlint's shape with byte spans", () => {
    const parsed = JSON.parse(formatReport(result, 'json', plain)) as {
      diagnostics: unknown[];
      number_of_files: number;
    };
    expect(parsed.number_of_files).toBe(3);
    expect(parsed.diagnostics).toHaveLength(3);
    expect(parsed.diagnostics[0]).toEqual({
      message: '"x" is not a valid Tailwind class.',
      code: 'tailwindcss(no-unknown-classes)',
      severity: 'error',
      causes: [],
      filename: app,
      labels: [{ span: { offset: 42, length: 1, line: 3, column: 16 } }],
      related: [],
    });
  });

  it('keeps help and url when present, and honors --quiet', () => {
    const rich: LintResult = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [
        finding({ help: 'Remove it.', url: 'https://example.com/rule' }),
        result.findings[1] as Finding,
      ],
      files: result.files,
    };
    const parsed = JSON.parse(
      formatReport(rich, 'json', { ...plain, quiet: true }),
    ) as { diagnostics: Record<string, unknown>[] };
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]).toMatchObject({
      help: 'Remove it.',
      url: 'https://example.com/rule',
    });
  });

  it('reports a file that was not checked as an error', () => {
    const unchecked: LintResult = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [],
      files: [
        { file: broken, skipped: [], notices: [], notChecked: 'Bad file.' },
      ],
    };
    const parsed = JSON.parse(
      formatReport(unchecked, 'json', { ...plain, quiet: true }),
    ) as { diagnostics: Record<string, unknown>[] };
    expect(parsed.diagnostics).toEqual([
      {
        message: 'Bad file.',
        code: 'oxlint-tailwindcss-vue(not-checked)',
        severity: 'error',
        causes: [],
        filename: broken,
        labels: [{ span: { offset: 0, length: 0, line: 1, column: 1 } }],
        related: [],
      },
    ]);
  });
});

describe('github format', () => {
  it('prints workflow commands', () => {
    expect(formatReport(result, 'github', plain)).toBe(
      [
        '::error file=src/App.vue,line=3,col=14,title=tailwindcss/no-unknown-classes::"x" is not a valid Tailwind class.',
        '::warning file=src/App.vue,line=5,col=3,title=tailwindcss/no-duplicate-classes::"p-1" is duplicated.',
        '::error file=src/Card.vue,line=2,col=9,title=tailwindcss/no-unknown-classes::"x" is not a valid Tailwind class.',
        '',
      ].join('\n'),
    );
  });

  it('escapes message and property values', () => {
    const tricky: LintResult = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [
        finding({
          file: join(cwd, 'a,b:c%.vue'),
          message: '100%\r\nnext: line, here',
        }),
      ],
      files: [],
    };
    expect(formatReport(tricky, 'github', plain)).toBe(
      '::error file=a%2Cb%3Ac%25.vue,line=3,col=14,title=tailwindcss/no-unknown-classes::100%25%0D%0Anext: line, here\n',
    );
  });

  it('reports a file that was not checked and honors --quiet', () => {
    const unchecked: LintResult = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [result.findings[1] as Finding],
      files: [
        { file: broken, skipped: [], notices: [], notChecked: 'Bad file.' },
      ],
    };
    expect(formatReport(unchecked, 'github', { ...plain, quiet: true })).toBe(
      '::error file=src/Broken.vue,title=not-checked::Bad file.\n',
    );
  });
});

describe('exitCodeFor', () => {
  const base = { quiet: false, denyWarnings: false };
  const warning = result.findings[1] as Finding;
  const error = result.findings[0] as Finding;
  const files = result.files;
  const twoWarnings = (
    warningOptions: LintResult['warningOptions'],
  ): LintResult => ({
    skippedConfigs: [],
    warningOptions,
    findings: [warning, warning],
    files,
  });

  it('is 1 with an error', () => {
    expect(
      exitCodeFor(
        { skippedConfigs: [], warningOptions: {}, findings: [error], files },
        base,
      ),
    ).toBe(1);
  });

  it('is 1 with a file that was not checked', () => {
    const unchecked = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [],
      files: [{ file: broken, skipped: [], notices: [], notChecked: 'x' }],
    };
    expect(exitCodeFor(unchecked, { ...base, quiet: true })).toBe(1);
  });

  it('is 0 with warnings only', () => {
    expect(
      exitCodeFor(
        { skippedConfigs: [], warningOptions: {}, findings: [warning], files },
        base,
      ),
    ).toBe(0);
    expect(
      exitCodeFor(
        { skippedConfigs: [], warningOptions: {}, findings: [], files: [] },
        base,
      ),
    ).toBe(0);
  });

  it('is 1 above --max-warnings', () => {
    const two = {
      skippedConfigs: [],
      warningOptions: {},
      findings: [warning, warning],
      files,
    };
    expect(exitCodeFor(two, { ...base, maxWarnings: 2 })).toBe(0);
    expect(exitCodeFor(two, { ...base, maxWarnings: 1 })).toBe(1);
  });

  it('is 1 with --deny-warnings and a warning', () => {
    expect(
      exitCodeFor(
        { skippedConfigs: [], warningOptions: {}, findings: [warning], files },
        { ...base, denyWarnings: true },
      ),
    ).toBe(1);
  });

  it('ignores warnings when quiet', () => {
    expect(
      exitCodeFor(
        { skippedConfigs: [], warningOptions: {}, findings: [warning], files },
        { quiet: true, denyWarnings: true, maxWarnings: 0 },
      ),
    ).toBe(0);
  });

  describe('with the warning options of the oxlint config', () => {
    it('applies maxWarnings unless --max-warnings is given', () => {
      expect(exitCodeFor(twoWarnings({ maxWarnings: 1 }), base)).toBe(1);
      expect(exitCodeFor(twoWarnings({ maxWarnings: 2 }), base)).toBe(0);
      expect(
        exitCodeFor(twoWarnings({ maxWarnings: 1 }), {
          ...base,
          maxWarnings: 5,
        }),
      ).toBe(0);
      expect(
        exitCodeFor(twoWarnings({ maxWarnings: 5 }), {
          ...base,
          maxWarnings: 1,
        }),
      ).toBe(1);
    });

    it('applies denyWarnings, even with --max-warnings', () => {
      expect(exitCodeFor(twoWarnings({ denyWarnings: false }), base)).toBe(0);
      expect(exitCodeFor(twoWarnings({ denyWarnings: true }), base)).toBe(1);
      expect(
        exitCodeFor(twoWarnings({ denyWarnings: true }), {
          ...base,
          maxWarnings: 5,
        }),
      ).toBe(1);
    });

    it('still ignores warnings when quiet', () => {
      expect(
        exitCodeFor(twoWarnings({ denyWarnings: true, maxWarnings: 0 }), {
          ...base,
          quiet: true,
        }),
      ).toBe(0);
    });
  });
});
