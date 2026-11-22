const LINE_COMMENT_LANGS = new Set(['scss', 'sass', 'less', 'styl', 'stylus']);
const INDENTED_LANGS = new Set(['sass', 'styl', 'stylus']);
const IDENT_CHAR = String.raw`(?:[\w\u0080-￿-]|\\[0-9a-fA-F]{1,6}\s?|\\[^\n0-9a-fA-F])`;
const CLASS = new RegExp(
  String.raw`\.((?:[_a-zA-Z\u0080-￿-]|\\[0-9a-fA-F]{1,6}\s?|\\[^\n0-9a-fA-F])${IDENT_CHAR}*)(#\{|@\{)?`,
  'g',
);
const KEYFRAME_STEPS =
  /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/;
const UTILITY_NAME = /^\S+/;

interface Frame {
  selectors: string[] | null;
}

export function collectStyleClasses(
  content: string,
  lang: string | undefined,
  module: boolean,
): string[] {
  const language = lang ?? 'css';
  const text = INDENTED_LANGS.has(language) ? toBraces(content) : content;
  const lineComments = LINE_COMMENT_LANGS.has(language);
  const names = new Set<string>();
  const stack: Frame[] = [];
  const inherited = (): string[] =>
    stack.findLast((frame) => frame.selectors)?.selectors ?? [];
  const open = (selectors: string[] | null): void => {
    for (const selector of selectors ?? []) {
      addClasses(module ? globalParts(selector) : selector, names);
    }
    stack.push({ selectors });
  };
  let prelude = '';
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    const next = text.charAt(i + 1);
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      prelude += ' ';
    } else if (
      lineComments &&
      c === '/' &&
      next === '/' &&
      text.charAt(i - 1) !== ':'
    ) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text.charAt(j) !== c && text.charAt(j) !== '\n')
        j += text.charAt(j) === '\\' ? 2 : 1;
      prelude += '""';
      i = j + 1;
    } else if (c === '\\') {
      prelude += text.slice(i, i + 2);
      i += 2;
    } else if ((c === '#' || c === '@') && next === '{') {
      const end = text.indexOf('}', i);
      prelude += text.slice(i, end < 0 ? text.length : end + 1);
      i = end < 0 ? text.length : end + 1;
    } else if (
      /^url\(/i.test(text.slice(i, i + 4)) &&
      !/[\w-]/.test(text.charAt(i - 1))
    ) {
      const end = text.indexOf(')', afterQuotedUrl(text, i + 4));
      i = end < 0 ? text.length : end + 1;
      prelude += ' ';
    } else if (c === '{') {
      openBlock(prelude.trim(), names, inherited, open);
      prelude = '';
      i++;
    } else if (c === '}' || c === ';') {
      if (c === '}') stack.pop();
      prelude = '';
      i++;
    } else {
      prelude += c;
      i++;
    }
  }
  return [...names].toSorted();
}

function afterQuotedUrl(text: string, from: number): number {
  let start = from;
  while (/\s/.test(text.charAt(start))) start++;
  const quote = text.charAt(start);
  if (quote !== '"' && quote !== "'") return from;
  let end = start + 1;
  while (end < text.length && text.charAt(end) !== quote)
    end += text.charAt(end) === '\\' ? 2 : 1;
  return end + 1;
}

function openBlock(
  header: string,
  names: Set<string>,
  inherited: () => string[],
  open: (selectors: string[] | null) => void,
): void {
  if (header.startsWith('@utility')) {
    const name = UTILITY_NAME.exec(header.slice('@utility'.length).trim())?.[0];
    if (name && !name.includes('#{') && !name.includes('@{'))
      names.add(name.endsWith('*') ? name.slice(0, -1) : name);
    open(null);
  } else if (header.startsWith('@at-root')) {
    const rest = header
      .slice('@at-root'.length)
      .trim()
      .replace(/#\{\s*&\s*\}/g, inherited()[0] ?? '');
    open(resolve([], rest));
  } else if (
    header.startsWith('@') ||
    header.startsWith('%') ||
    header.endsWith(':') ||
    KEYFRAME_STEPS.test(header)
  ) {
    open(null);
  } else {
    open(resolve(inherited(), header));
  }
}

function resolve(parents: readonly string[], prelude: string): string[] {
  const own = splitTopLevel(prelude, ',');
  if (parents.length === 0) return own.map((s) => s.replaceAll('&', ''));
  return parents.flatMap((parent) =>
    own.map((sel) =>
      sel.includes('&') ? sel.replaceAll('&', parent) : `${parent} ${sel}`,
    ),
  );
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === '\\') i++;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function globalParts(selector: string): string {
  const marker = ':global(';
  const parts: string[] = [];
  let from = selector.indexOf(marker);
  while (from >= 0) {
    const start = from + marker.length;
    let depth = 1;
    let end = start;
    while (end < selector.length && depth > 0) {
      const c = selector.charAt(end);
      if (c === '\\') end++;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      end++;
    }
    parts.push(selector.slice(start, depth === 0 ? end - 1 : end));
    from = selector.indexOf(marker, end);
  }
  return parts.join(' ');
}

function addClasses(selector: string, names: Set<string>): void {
  for (const match of selector.replace(/\[[^\]]*\]/g, '').matchAll(CLASS)) {
    const raw = match[1] as string;
    if (match[2]) continue;
    const name = unescapeIdent(raw);
    if (/^-?\d/.test(name) && !raw.startsWith('\\')) continue;
    names.add(name);
  }
}

function unescapeIdent(raw: string): string {
  return raw.replace(
    /\\([0-9a-fA-F]{1,6})\s?|\\(.)/g,
    (_, hex: string | undefined, char: string) =>
      hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char,
  );
}

function toBraces(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('//'))
    .map((line) => ({
      indent: line.length - line.trimStart().length,
      text: line.trim(),
    }));
  const open: number[] = [];
  let out = '';
  lines.forEach((line, index) => {
    while (open.length > 0 && line.indent <= (open.at(-1) as number)) {
      out += '}\n';
      open.pop();
    }
    const following = lines[index + 1];
    if (following && following.indent > line.indent) {
      out += `${line.text} {\n`;
      open.push(line.indent);
    } else {
      out += `${line.text};\n`;
    }
  });
  return out + '}\n'.repeat(open.length);
}
