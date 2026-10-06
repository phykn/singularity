import type { Result } from '../game/types.ts';
import { rules } from '../game/rules.ts';
import type { Language } from '../ui/i18n.ts';

export type Settings = { sound: boolean };
export type BestRecord = Pick<
  Result,
  'outcome' | 'xp' | 'level' | 'speed' | 'seed' | 'collisionTime'
>;
export const settingsKey = 'singularity.settings';
export const recordKey = 'singularity.record';
export const languageKey = 'singularity.language';

export function readLanguage(storage: Storage): Language {
  try {
    const value = JSON.parse(storage.getItem(languageKey) ?? 'null');
    if (['ko', 'en', 'zh', 'ja'].includes(value)) return value;
  } catch {
    /* Storage can be disabled by the browser. */
  }
  return 'ko';
}

export function readSettings(storage: Storage): Settings {
  try {
    const value = JSON.parse(storage.getItem(settingsKey) ?? 'null');
    if (typeof value?.sound === 'boolean') return { sound: value.sound };
  } catch {
    /* Storage can be disabled by the browser. */
  }
  return { sound: false };
}
export function readRecord(storage: Storage): BestRecord | null {
  try {
    const value = JSON.parse(storage.getItem(recordKey) ?? 'null');
    if (!value || !['success', 'collapse-failure'].includes(value.outcome)) return null;
    if (
      !['xp', 'level', 'seed'].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
    )
      return null;
    if (
      !Number.isFinite(value.speed) ||
      value.speed < rules.baseSpeed ||
      !Number.isFinite(value.collisionTime) ||
      value.collisionTime < 0
    )
      return null;
    if (value.level < 1 || value.seed > 0xffffffff) return null;
    return value;
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
export function bestRecord(current: BestRecord | null, result: Result): BestRecord | null {
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
  const { outcome, xp, level, speed, seed, collisionTime } = result;
  return { outcome, xp, level, speed, seed, collisionTime };
}
