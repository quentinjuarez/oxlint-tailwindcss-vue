import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ToolError } from './errors.js';
import type { FileReport, Finding } from './lint.js';
import type { OxlintDiagnostic } from './oxlint/report.js';
import { createPositionMapper, type Position } from './positions.js';

export interface VirtualSource {
  report: FileReport;
  source: string;
  code: string;
  styleClasses?: readonly string[];
}

export interface MappingContext {
  cwd: string;
  root: string;
  themes?: { cwd: string; paths: readonly string[] };
  files: ReadonlyMap<string, VirtualSource>;
}

const PLUGIN_CRASH = 'Error running JS plugin';
const WILDCARD_UTILITY_END = '-*';

function virtualPathOf(filename: string, cwd: string): string {
  return filename.startsWith('file://')
    ? fileURLToPath(filename)
    : resolve(cwd, filename);
}

function quotedStart(styleClass: string): string {
  return styleClass.endsWith(WILDCARD_UTILITY_END)
    ? `"${styleClass.slice(0, -1)}`
    : `"${styleClass}"`;
}

function isStyleClassReport(
  diagnostic: OxlintDiagnostic,
  styleClasses: readonly string[] | undefined,
): boolean {
  return (
    diagnostic.code?.endsWith('(no-unknown-classes)') === true &&
    styleClasses?.some((name) =>
      diagnostic.message.startsWith(quotedStart(name)),
    ) === true
  );
}

function withThemePaths(message: string, context: MappingContext): string {
  const { themes } = context;
  if (themes === undefined) return message;
  let rewritten = message;
  for (const path of themes.paths) {
    const written = relative(context.cwd, path);
    const original = relative(themes.cwd, path);
    for (const variant of new Set([written, written.replaceAll(sep, '/')])) {
      rewritten = rewritten.replaceAll(variant, original);
    }
  }
  return rewritten;
}

function withOriginalPaths(message: string, context: MappingContext): string {
  const themed = withThemePaths(message, context);
  if (!themed.includes(context.root)) return themed;
  let rewritten = themed;
  for (const [virtualPath, { report }] of context.files) {
    rewritten = rewritten.replaceAll(virtualPath, report.file);
  }
  return rewritten;
}

export function mapDiagnostics(
  diagnostics: readonly OxlintDiagnostic[],
  context: MappingContext,
): Finding[] {
  const mappers = new Map<VirtualSource, (byteOffset: number) => Position>();
  const findings: Finding[] = [];
  for (const diagnostic of diagnostics) {
    const file =
      diagnostic.filename === undefined
        ? undefined
        : context.files.get(virtualPathOf(diagnostic.filename, context.cwd));
    if (file === undefined) {
      throw new ToolError(
        `oxlint reported a file it was not asked to check: ${diagnostic.filename ?? 'no file name'}\n${diagnostic.message}`,
      );
    }
    if (isStyleClassReport(diagnostic, file.styleClasses)) continue;
    const message = withOriginalPaths(diagnostic.message, context);
    // oxlint 1.94 reports a parse error of the virtual file, and a JS plugin
    // crash (its message starts with PLUGIN_CRASH), without a code.
    if (diagnostic.code === undefined) {
      if (message.startsWith(PLUGIN_CRASH)) {
        throw new ToolError(
          `oxlint-tailwindcss crashed on ${file.report.file}:\n${message}`,
          'Report it to oxlint-tailwindcss-vue with the file that caused it.',
        );
      }
      file.report.notChecked ??= message;
      continue;
    }
    let position = mappers.get(file);
    if (position === undefined) {
      position = createPositionMapper(file.source, file.code);
      mappers.set(file, position);
    }
    const span = diagnostic.labels[0]?.span ?? { offset: 0, length: 0 };
    const finding: Finding = {
      file: file.report.file,
      rule: diagnostic.code.replace(/^([^()]+)\(([^()]+)\)$/, '$1/$2'),
      severity: diagnostic.severity === 'error' ? 'error' : 'warning',
      message,
      start: position(span.offset),
      end: position(span.offset + span.length),
    };
    if (diagnostic.help !== undefined) finding.help = diagnostic.help;
    if (diagnostic.url !== undefined) finding.url = diagnostic.url;
    findings.push(finding);
  }
  return findings;
}
