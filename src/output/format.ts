import { relative, sep } from 'node:path';
import { styleText } from 'node:util';

import type { FileReport, Finding, LintResult } from '../lint.js';

export type OutputFormat = 'default' | 'json' | 'github';

export interface FormatOptions {
  cwd: string;
  quiet: boolean;
  debug: boolean;
  color: boolean;
}

export interface ExitOptions {
  quiet: boolean;
  maxWarnings?: number;
  denyWarnings: boolean;
}

const NOT_CHECKED_CODE = 'oxlint-tailwindcss-vue(not-checked)';

export function formatReport(
  result: LintResult,
  format: OutputFormat,
  options: FormatOptions,
): string {
  const findings = visibleFindings(result, options.quiet);
  const notChecked = result.files.filter((report) => report.notChecked);
  if (format === 'json') return formatJson(result, findings, notChecked);
  if (format === 'github') return formatGithub(findings, notChecked, options);
  return formatDefault(result, findings, notChecked, options);
}

export function exitCodeFor(result: LintResult, options: ExitOptions): 0 | 1 {
  const findings = visibleFindings(result, options.quiet);
  const warnings = findings.filter(({ severity }) => severity === 'warning');
  if (findings.length > warnings.length) return 1;
  if (result.files.some((report) => report.notChecked)) return 1;
  const { warningOptions } = result;
  const denyWarnings =
    options.denyWarnings || warningOptions.denyWarnings === true;
  const maxWarnings = options.maxWarnings ?? warningOptions.maxWarnings;
  if (denyWarnings && warnings.length > 0) return 1;
  if (maxWarnings !== undefined && warnings.length > maxWarnings) return 1;
  return 0;
}

function visibleFindings(result: LintResult, quiet: boolean): Finding[] {
  return quiet
    ? result.findings.filter(({ severity }) => severity === 'error')
    : result.findings;
}

function displayPath(file: string, cwd: string): string {
  return relative(cwd, file).split(sep).join('/');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

type Paint = (style: 'red' | 'yellow' | 'dim' | 'bold', text: string) => string;

function painter(color: boolean): Paint {
  return (style, text) =>
    color ? styleText(style, text, { validateStream: false }) : text;
}

export function formatDebug(
  result: LintResult,
  options: { cwd: string; color: boolean },
): string {
  const lines = debugLines(result, options.cwd, painter(options.color));
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function debugLines(result: LintResult, cwd: string, paint: Paint): string[] {
  const lines: string[] = [];
  for (const skipped of result.skippedConfigs) {
    lines.push(
      `skipped ${plural(skipped.files, '.vue file')}: ${displayPath(skipped.config, cwd)} does not load oxlint-tailwindcss`,
    );
  }
  for (const report of result.files) {
    const path = displayPath(report.file, cwd);
    for (const skip of report.skipped) {
      lines.push(
        `${paint('dim', `${path}:${skip.line}:${skip.column}`)} skipped ${skip.code} ${skip.attribute}`,
      );
    }
    for (const notice of report.notices) {
      lines.push(
        `${paint('dim', `${path}:${notice.line}:${notice.column}`)} notice ${notice.code} ${notice.key}`,
      );
    }
    for (const refused of report.refusedFixes ?? []) {
      lines.push(
        `${paint('dim', `${path}:${refused.line}:${refused.column}`)} fix refused ${refused.code}`,
      );
    }
  }
  return lines;
}

function formatDefault(
  result: LintResult,
  findings: Finding[],
  notChecked: FileReport[],
  options: FormatOptions,
): string {
  const { cwd } = options;
  const paint = painter(options.color);
  const lines: string[] = [];

  for (const finding of findings) {
    const place = `${displayPath(finding.file, cwd)}:${finding.start.line}:${finding.start.column}`;
    const severity = paint(
      finding.severity === 'error' ? 'red' : 'yellow',
      finding.severity,
    );
    lines.push(
      `${paint('dim', place)} ${severity} ${paint('dim', finding.rule)} ${finding.message}`,
    );
  }
  for (const report of notChecked) {
    lines.push(
      `${displayPath(report.file, cwd)} ${paint('red', 'not checked:')} ${report.notChecked}`,
    );
  }
  if (options.debug) lines.push(...debugLines(result, cwd, paint));

  if (findings.length === 0 && notChecked.length === 0) {
    lines.push(`No problems found in ${plural(result.files.length, 'file')}.`);
    return `${lines.join('\n')}\n`;
  }

  const errors = findings.filter(({ severity }) => severity === 'error').length;
  const counts = [paint('red', plural(errors, 'error'))];
  if (!options.quiet) {
    counts.push(paint('yellow', plural(findings.length - errors, 'warning')));
  }
  let summary = counts.join(', ');
  if (findings.length > 0) {
    const files = new Set(findings.map(({ file }) => file)).size;
    summary += ` in ${plural(files, 'file')}`;
  }
  if (notChecked.length > 0) {
    summary += `, ${plural(notChecked.length, 'file')} not checked`;
  }
  lines.push('', paint('bold', summary));
  return `${lines.join('\n')}\n`;
}

function ruleCode(rule: string): string {
  const slash = rule.indexOf('/');
  return slash === -1
    ? rule
    : `${rule.slice(0, slash)}(${rule.slice(slash + 1)})`;
}

function formatJson(
  result: LintResult,
  findings: Finding[],
  notChecked: FileReport[],
): string {
  const diagnostics = [
    ...findings.map((finding) => ({
      message: finding.message,
      code: ruleCode(finding.rule),
      severity: finding.severity,
      causes: [],
      ...(finding.url === undefined ? {} : { url: finding.url }),
      ...(finding.help === undefined ? {} : { help: finding.help }),
      filename: finding.file,
      labels: [
        {
          span: {
            offset: finding.start.byteOffset,
            length: finding.end.byteOffset - finding.start.byteOffset,
            line: finding.start.line,
            column: finding.start.byteColumn,
          },
        },
      ],
      related: [],
    })),
    ...notChecked.map((report) => ({
      message: report.notChecked,
      code: NOT_CHECKED_CODE,
      severity: 'error',
      causes: [],
      filename: report.file,
      labels: [{ span: { offset: 0, length: 0, line: 1, column: 1 } }],
      related: [],
    })),
  ];
  return `${JSON.stringify({ diagnostics, number_of_files: result.files.length }, null, 2)}\n`;
}

function escapeData(text: string): string {
  return text
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function formatGithub(
  findings: Finding[],
  notChecked: FileReport[],
  options: FormatOptions,
): string {
  const lines = findings.map((finding) => {
    const file = escapeProperty(displayPath(finding.file, options.cwd));
    const title = escapeProperty(finding.rule);
    return `::${finding.severity} file=${file},line=${finding.start.line},col=${finding.start.column},title=${title}::${escapeData(finding.message)}`;
  });
  for (const report of notChecked) {
    const file = escapeProperty(displayPath(report.file, options.cwd));
    lines.push(
      `::error file=${file},title=not-checked::${escapeData(report.notChecked ?? '')}`,
    );
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
