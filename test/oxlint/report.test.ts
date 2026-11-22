import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ToolError } from '../../src/errors.js';
import { parseOxlintReport } from '../../src/oxlint/report.js';

const sample = readFileSync(
  new URL('../fixtures/oxlint/report.json', import.meta.url),
  'utf8',
);

describe('parseOxlintReport', () => {
  it('parses an oxlint 1.94 JSON report', () => {
    const report = parseOxlintReport(sample);
    expect(report.number_of_files).toBe(2);
    const codes = report.diagnostics.map((d) => d.code);
    expect(codes).toContain('tailwindcss(no-unknown-classes)');
    expect(codes).toContain(undefined);
    const parseError = report.diagnostics.find((d) => d.code === undefined);
    expect(parseError?.labels[0]?.span.offset).toBe(6);
  });

  it('skips the "No files found" text before the JSON', () => {
    const report = parseOxlintReport(`No files found to lint.\n${sample}`);
    expect(report.diagnostics).toHaveLength(3);
  });

  it('throws a ToolError on plain text', () => {
    expect(() =>
      parseOxlintReport('Failed to parse oxlint configuration'),
    ).toThrow(ToolError);
  });

  it('throws a ToolError on a JSON value that is not a report', () => {
    expect(() => parseOxlintReport('{ "nope": 1 }')).toThrow(ToolError);
    expect(() => parseOxlintReport('{ broken')).toThrow(ToolError);
  });
});
