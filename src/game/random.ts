// FNV-1a; names a random stream and fingerprints rule sets.
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// One named stream per seed: a draw added to one stream never shifts another.
export class Random {
  state: number;
  constructor(seed: number, name = '') {
    this.state = (seed ^ hash(name)) >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(this.state ^ (this.state >>> 15), this.state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  }
  // A value in [-1, 1) for symmetric variation.
  spread(): number {
    return this.next() * 2 - 1;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  shuffle<T>(input: readonly T[]): T[] {
    const items = [...input];
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
