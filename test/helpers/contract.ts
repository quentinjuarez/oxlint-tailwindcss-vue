import { parse } from '@babel/parser';

const WRAPPER_CHARACTERS = new Set([';', '_', '(', ')', '`', '/', '*']);

function isLineBreak(character: string | undefined): boolean {
  return character === '\n' || character === '\r';
}

function isAscii(character: string): boolean {
  return character.charCodeAt(0) < 128;
}

export function assertContract(source: string, code: string): void {
  if (code.length !== source.length) {
    throw new Error(
      `length differs: source ${source.length}, virtual ${code.length}`,
    );
  }
  for (let index = 0; index < source.length; index++) {
    const original = source[index] as string;
    const virtual = code[index] as string;
    if (isLineBreak(original) || isLineBreak(virtual)) {
      if (original !== virtual) {
        throw new Error(
          `line break mismatch at ${index}: source ${JSON.stringify(original)}, virtual ${JSON.stringify(virtual)}`,
        );
      }
      continue;
    }
    if (virtual === ' ' || virtual === original) continue;
    if (WRAPPER_CHARACTERS.has(virtual) && isAscii(original)) continue;
    throw new Error(
      `invalid character at ${index}: source ${JSON.stringify(original)}, virtual ${JSON.stringify(virtual)}`,
    );
  }
  try {
    parse(code, { sourceType: 'module', plugins: ['typescript'] });
  } catch (error) {
    throw new Error(
      `virtual file does not parse: ${(error as Error).message}`,
      { cause: error },
    );
  }
}
