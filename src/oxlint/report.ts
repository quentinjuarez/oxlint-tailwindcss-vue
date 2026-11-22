import { ToolError } from '../errors.js';

export interface OxlintLabel {
  label?: string;
  span: { offset: number; length: number; line: number; column: number };
}

export interface OxlintDiagnostic {
  message: string;
  code?: string;
  severity: 'error' | 'warning' | 'advice';
  url?: string;
  help?: string;
  filename?: string;
  labels: OxlintLabel[];
}

export interface OxlintReport {
  diagnostics: OxlintDiagnostic[];
  number_of_files: number;
}

function isReport(value: unknown): value is OxlintReport {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as Partial<OxlintReport>;
  return (
    Array.isArray(report.diagnostics) &&
    typeof report.number_of_files === 'number'
  );
}

export function parseOxlintReport(stdout: string): OxlintReport {
  const start = stdout.indexOf('{');
  if (start === -1) throw notAReport(stdout);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    throw notAReport(stdout);
  }
  if (!isReport(parsed)) throw notAReport(stdout);
  return parsed;
}

function notAReport(stdout: string): ToolError {
  const text = stdout.trim();
  return new ToolError(
    text === ''
      ? 'oxlint printed no JSON report'
      : `oxlint did not print a JSON report:\n${text}`,
  );
}
