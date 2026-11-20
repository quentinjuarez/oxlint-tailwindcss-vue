export type SkipCode =
  | 'entity'
  | 'invalid-expression'
  | 'invalid-escape'
  | 'quote-in-unquoted-value'
  | 'no-room'
  | 'template-wrapper'
  | 'template-lang'
  | 'template-src'
  | 'parse-safety-net';

export interface SourceSpan {
  start: number;
  end: number;
}

export interface Skip {
  code: SkipCode;
  attribute: string;
  span: SourceSpan;
}

export interface Notice {
  code: 'unquoted-key';
  key: string;
  span: SourceSpan;
}

export interface Rewrite {
  kind: 'static' | 'bound' | 'comment';
  attribute: string;
  span: SourceSpan;
}

export interface VirtualizeOptions {
  attributes?: readonly string[];
  attributePatterns?: readonly string[];
}

export interface VirtualizeResult {
  code: string | null;
  rewrites: Rewrite[];
  skipped: Skip[];
  notices: Notice[];
  styleClasses: string[];
}
