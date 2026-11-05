import type { Result } from '../game/types.ts';
import { languages } from '../ui/i18n.ts';
import type { Language } from '../ui/i18n.ts';

export type BestRecord = Pick<Result, 'outcome' | 'xp' | 'level' | 'seed' | 'collisionTime'>;
const pickRecord = ({ outcome, xp, level, seed, collisionTime }: BestRecord): BestRecord => ({
  outcome,
  xp,
  level,
  seed,
  collisionTime,
});
export const recordKey = 'singularity.record';
export const beyondRecordKey = 'singularity.beyond';
export type BeyondRecord = { seconds: number; xp: number; seed: number };
export const languageKey = 'singularity.language';
export const soundKey = 'singularity.sound';

export function readLanguage(storage: Storage): Language {
  try {
    const value = JSON.parse(storage.getItem(languageKey) ?? 'null');
    if (languages.some(({ id }) => id === value)) return value;
  } catch {
    /* Storage can be disabled by the browser. */
  }
  return 'ko';
}

// Sound is on unless the player turned it off.
export function readSound(storage: Storage): boolean {
  try {
    return JSON.parse(storage.getItem(soundKey) ?? 'true') !== false;
  } catch {
    return true;
  }
}
export const writeSound = (storage: Storage, sound: boolean) => save(storage, soundKey, sound);

export function readRecord(storage: Storage): BestRecord | null {
  try {
    const value = JSON.parse(storage.getItem(recordKey) ?? 'null');
    if (!value || !['success', 'collapse-failure'].includes(value.outcome)) return null;
    if (
      !['xp', 'level', 'seed'].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
    )
      return null;
    if (!Number.isFinite(value.collisionTime) || value.collisionTime < 0) return null;
    if (value.level < 1 || value.seed > 0xffffffff) return null;
    return pickRecord(value);
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
export function bestRecord(
  current: BestRecord | null,
  result: Result | BestRecord,
): BestRecord | null {
  if ('endless' in result && result.endless) return current;
  const score = (record: BestRecord) => [
    Number(record.outcome === 'success'),
    record.xp,
    record.collisionTime,
  ];
  if (current) {
    const old = score(current),
      next = score(result);
    const different = old.findIndex((value, i) => value !== next[i]);
    if (different < 0 || old[different] > next[different]) return current;
  }
  return pickRecord(result);
}

export function readBeyondRecord(storage: Storage): BeyondRecord | null {
  try {
    const record = JSON.parse(storage.getItem(beyondRecordKey) ?? 'null');
    if (
      record &&
      Number.isFinite(record.seconds) &&
      record.seconds >= 0 &&
      Number.isSafeInteger(record.xp) &&
      record.xp >= 0 &&
      Number.isSafeInteger(record.seed) &&
      record.seed >= 0 &&
      record.seed <= 0xffffffff
    ) {
      const { seconds, xp, seed } = record;
      return { seconds, xp, seed };
    }
  } catch {
    /* Storage can be disabled by the browser. */
  }
  return null;
}

export function bestBeyondRecord(
  current: BeyondRecord | null,
  result: Result | BeyondRecord,
): BeyondRecord | null {
  const next =
    'endless' in result ? result.endless && { ...result.endless, seed: result.seed } : result;
  if (!next) return current;
  return !current ||
    next.seconds > current.seconds ||
    (next.seconds === current.seconds && next.xp > current.xp)
    ? next
    : current;
}
