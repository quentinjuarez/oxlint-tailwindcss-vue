function isLineBreak(character: string): boolean {
  return character === '\n' || character === '\r';
}

export class VirtualBuffer {
  readonly #source: string;
  readonly #units: string[];
  readonly #used: Uint8Array;
  readonly #regionOf: Int32Array;
  readonly #regions = new Map<number, number[]>();
  #open: number[] | undefined;
  #nextRegion = 1;

  constructor(source: string) {
    this.#source = source;
    this.#units = Array.from({ length: source.length }, (_, index) =>
      this.#blank(index),
    );
    this.#used = new Uint8Array(source.length);
    this.#regionOf = new Int32Array(source.length);
  }

  isFree(index: number): boolean {
    if (index < 0 || index >= this.#source.length || this.#used[index] === 1)
      return false;
    const character = this.#source[index] as string;
    return character.charCodeAt(0) < 128 && !isLineBreak(character);
  }

  begin(): void {
    if (this.#open) throw new Error('a region is already open');
    this.#open = [];
  }

  commit(): number {
    const written = this.#requireOpen();
    const id = this.#nextRegion++;
    for (const index of written) this.#regionOf[index] = id;
    this.#regions.set(id, written);
    this.#open = undefined;
    return id;
  }

  rollback(): void {
    this.#release(this.#requireOpen());
    this.#open = undefined;
  }

  write(index: number, text: string): void {
    const written = this.#requireOpen();
    if (index < 0 || index + text.length > this.#source.length) {
      throw new RangeError(`write out of range at ${index}`);
    }
    for (let offset = 0; offset < text.length; offset++) {
      const target = index + offset;
      if (this.#used[target] === 1)
        throw new Error(`slot ${target} is already written`);
      this.#units[target] = text[offset] as string;
      this.#used[target] = 1;
      written.push(target);
    }
  }

  copy(start: number, end: number): void {
    this.write(start, this.#source.slice(start, end));
  }

  placeCall(from: number, to: number, callee: string): boolean {
    this.#requireOpen();
    const paren = this.#lastFree(Math.min(to, this.#source.length) - 1, from);
    if (paren === undefined) return false;
    const calleeStart = this.#lastFreeRun(
      paren - callee.length,
      from,
      callee.length,
    );
    if (calleeStart === undefined) return false;
    const semicolon = this.#lastFree(calleeStart - 1, from);
    if (semicolon === undefined) return false;
    this.write(semicolon, ';');
    this.write(calleeStart, callee);
    this.write(paren, '(');
    return true;
  }

  placeAfter(from: number, text: string): boolean {
    this.#requireOpen();
    for (let index = Math.max(from, 0); index < this.#source.length; index++) {
      if (!this.isFree(index)) continue;
      if (!this.#isRunFree(index, text.length)) return false;
      this.write(index, text);
      return true;
    }
    return false;
  }

  undo(region: number): void {
    const written = this.#regions.get(region);
    if (!written) return;
    this.#release(written);
    this.#regions.delete(region);
  }

  regionAt(index: number): number | undefined {
    const id = this.#regionOf[index];
    return id === undefined || id === 0 ? undefined : id;
  }

  toString(): string {
    return this.#units.join('');
  }

  #blank(index: number): string {
    const character = this.#source[index] as string;
    return isLineBreak(character) ? character : ' ';
  }

  #requireOpen(): number[] {
    if (!this.#open) throw new Error('no open region');
    return this.#open;
  }

  #release(indices: readonly number[]): void {
    for (const index of indices) {
      this.#units[index] = this.#blank(index);
      this.#used[index] = 0;
      this.#regionOf[index] = 0;
    }
  }

  #lastFree(from: number, floor: number): number | undefined {
    for (let index = from; index >= floor; index--) {
      if (this.isFree(index)) return index;
    }
    return undefined;
  }

  #isRunFree(start: number, length: number): boolean {
    for (let offset = 0; offset < length; offset++) {
      if (!this.isFree(start + offset)) return false;
    }
    return true;
  }

  #lastFreeRun(
    from: number,
    floor: number,
    length: number,
  ): number | undefined {
    for (let start = from; start >= floor; start--) {
      if (this.#isRunFree(start, length)) return start;
    }
    return undefined;
  }
}
