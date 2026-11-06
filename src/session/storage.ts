// Saved preferences. Keys and formats are the old game's, so saved values keep working.
export const languageIds = ['ko', 'en', 'zh', 'ja'] as const;
export type Language = (typeof languageIds)[number];
export const keys = {
  language: 'singularity.language',
  sound: 'singularity.sound',
  record: 'singularity.record',
  beyond: 'singularity.beyond',
  seed: 'singularity.seed',
};

function read(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
export function save(storage: Storage, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Without a saved choice, the browser's language if it is one of the four, otherwise English.
export function readLanguage(storage: Storage, browser: readonly string[]): Language {
  const saved = read(storage, keys.language);
  if (languageIds.includes(saved as Language)) return saved as Language;
  const spoken = browser.map((tag) => tag.slice(0, 2).toLowerCase());
  return languageIds.find((id) => id === spoken[0]) ?? 'en';
}

// Sound is on unless the player turned it off.
export const readSound = (storage: Storage) => read(storage, keys.sound) !== false;

// A fresh seed that differs from the previous run's and from the one saved last page load.
export function newSeed(storage: Storage, previous?: number): number {
  const stored = Number(read(storage, keys.seed) ?? NaN),
    random = new Uint32Array(1);
  do crypto.getRandomValues(random);
  while (random[0] === previous || random[0] === stored);
  save(storage, keys.seed, random[0]);
  return random[0];
}

// Best results, stored exactly as the old game stored them.
export type BestRecord = {
  outcome: 'success' | 'collapse-failure';
  xp: number;
  level: number;
  seed: number;
  collisionTime: number;
};
export type BeyondRecord = { seconds: number; xp: number; seed: number };
type Finished = Pick<BestRecord, 'xp' | 'level' | 'seed' | 'collisionTime'> & {
  outcome: string;
  endless: { seconds: number; xp: number } | null;
};
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const span = (n: unknown): n is number => Number.isFinite(n) && (n as number) >= 0;
const seedLike = (n: unknown) => count(n) && n <= 0xffffffff;

export function readRecord(storage: Storage): BestRecord | null {
  const v = read(storage, keys.record) as Record<string, unknown> | null;
  if (!v || (v.outcome !== 'success' && v.outcome !== 'collapse-failure')) return null;
  if (!count(v.xp) || !count(v.level) || v.level < 1 || !seedLike(v.seed)) return null;
  if (!span(v.collisionTime)) return null;
  return {
    outcome: v.outcome,
    xp: v.xp,
    level: v.level,
    seed: v.seed as number,
    collisionTime: v.collisionTime,
  };
}
export function readBeyond(storage: Storage): BeyondRecord | null {
  const v = read(storage, keys.beyond) as Record<string, unknown> | null;
  if (!v || !span(v.seconds) || !count(v.xp) || !seedLike(v.seed)) return null;
  return { seconds: v.seconds, xp: v.xp, seed: v.seed as number };
}

// A clear beats a loss, then more XP, then a later end. Endless results never count here.
export function bestRecord(current: BestRecord | null, next: Finished | BestRecord) {
  if ('endless' in next && next.endless) return current;
  if (next.outcome !== 'success' && next.outcome !== 'collapse-failure') return current;
  const score = (r: BestRecord | Finished) => [+(r.outcome === 'success'), r.xp, r.collisionTime];
  if (current) {
    const old = score(current),
      fresh = score(next),
      i = old.findIndex((value, j) => value !== fresh[j]);
    if (i < 0 || old[i] > fresh[i]) return current;
  }
  const { outcome, xp, level, seed, collisionTime } = next as BestRecord;
  return { outcome, xp, level, seed, collisionTime };
}
// Longer survival beyond the singularity, then more XP gained there.
export function bestBeyond(current: BeyondRecord | null, next: Finished | BeyondRecord) {
  const run = 'endless' in next ? next.endless && { ...next.endless, seed: next.seed } : next;
  if (!run) return current;
  return !current ||
    run.seconds > current.seconds ||
    (run.seconds === current.seconds && run.xp > current.xp)
    ? run
    : current;
}

// Keeps the best of each mode in memory and in storage. Another tab may have written a
// better record meanwhile, so each write merges what is stored first; a failed write
// is retried later, at most one pending record per mode.
export class Records {
  best: BestRecord | null = null;
  beyond: BeyondRecord | null = null;
  // Whether the last recorded result became the best of its mode.
  improved = false;
  private readonly storage: () => Storage;
  private pending = new Map<'record' | 'beyond', number>();

  constructor(storage: () => Storage) {
    this.storage = storage;
    try {
      this.best = readRecord(storage());
      this.beyond = readBeyond(storage());
    } catch {
      /* Storage can be unavailable. */
    }
  }

  // Returns whether the write reached storage.
  record(result: Finished, wall: number): boolean {
    const mode = result.endless ? 'beyond' : 'record',
      before = mode === 'record' ? this.best : this.beyond;
    if (mode === 'record') this.best = bestRecord(this.best, result);
    else this.beyond = bestBeyond(this.beyond, result);
    this.improved = before !== (mode === 'record' ? this.best : this.beyond);
    return this.persist(mode, wall);
  }

  // Undefined when no write was due.
  retry(wall: number): boolean | undefined {
    let ok: boolean | undefined;
    for (const [mode, at] of this.pending)
      if (wall - at >= 1000) ok = this.persist(mode, wall) && ok !== false;
    return ok;
  }

  private persist(mode: 'record' | 'beyond', wall: number): boolean {
    let ok = false;
    try {
      const store = this.storage();
      if (mode === 'record') {
        const stored = readRecord(store);
        if (stored) this.best = bestRecord(this.best, stored);
        ok = save(store, keys.record, this.best);
      } else {
        const stored = readBeyond(store);
        if (stored) this.beyond = bestBeyond(this.beyond, stored);
        ok = save(store, keys.beyond, this.beyond);
      }
    } catch {
      /* Keep the best in memory and retry. */
    }
    if (ok) this.pending.delete(mode);
    else this.pending.set(mode, wall);
    return ok;
  }
}
