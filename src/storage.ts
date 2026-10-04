import { z } from 'zod';
import { Game } from './game.ts';
import type { Result } from './game.ts';
import { rules, skillIds, statIds } from './rules.ts';
import type { Language } from './i18n.ts';

export type Settings = { sound: boolean; reduced: boolean };
export type Record = Pick<Result, 'outcome' | 'xp' | 'level' | 'speed' | 'seed' | 'collisionTime'>;
export const settingsKey = 'singularity.settings';
export const recordKey = 'singularity.record';
export const languageKey = 'singularity.language';
export const runKey = 'singularity.run';

const checkpointSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff),
  ticks: z.number().int().min(0),
  phase: z.enum(['running', 'collapse', 'ending', 'result']), manualPaused: z.boolean(),
  inputs: z.array(z.object({ tick: z.number().int().min(0), id: z.enum([...skillIds, ...statIds]), number: z.number().int().min(1) })),
});

export function readRun(storage: Storage): Game | null {
  try {
    const checkpoint = checkpointSchema.safeParse(JSON.parse(storage.getItem(runKey) ?? 'null'));
    return checkpoint.success ? Game.restore(checkpoint.data) : null;
  } catch { return null; }
}

export function saveRun(storage: Storage, game: Game): boolean {
  const checkpoint = game.checkpoint();
  if (checkpoint) return save(storage, runKey, checkpoint);
  try { storage.removeItem(runKey); return true; }
  catch { return false; }
}

export function readLanguage(storage: Storage): Language {
  try {
    const value = JSON.parse(storage.getItem(languageKey) ?? 'null');
    if (['ko', 'en', 'zh', 'ja'].includes(value)) return value;
  } catch { /* Storage can be disabled by the browser. */ }
  return 'ko';
}

export function readSettings(storage: Storage, reduced = false): Settings {
  try {
    const value = JSON.parse(storage.getItem(settingsKey) ?? 'null');
    if (typeof value?.sound === 'boolean' && typeof value?.reduced === 'boolean') return value;
  } catch { /* Storage can be disabled by the browser. */ }
  return { sound: false, reduced };
}
export function readRecord(storage: Storage): Record | null {
  try {
    const value = JSON.parse(storage.getItem(recordKey) ?? 'null');
    if (!value || !['success', 'collapse-failure'].includes(value.outcome)) return null;
    if (!['xp', 'level', 'seed'].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
    if (!Number.isFinite(value.speed) || value.speed < rules.baseSpeed || !Number.isFinite(value.collisionTime) || value.collisionTime < 0) return null;
    if (value.level < 1 || value.seed > 0xffffffff) return null;
    return value;
  } catch { return null; }
}
export function save(storage: Storage, key: string, value: unknown): boolean {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function bestRecord(current: Record | null, result: Result): Record | null {
  const score = (record: Record) => [Number(record.outcome === 'success'), record.xp, record.collisionTime];
  if (current) {
    const old = score(current), next = score(result);
    const different = old.findIndex((value, i) => value !== next[i]);
    if (different < 0 || old[different] > next[different]) return current;
  }
  const { outcome, xp, level, speed, seed, collisionTime } = result;
  return { outcome, xp, level, speed, seed, collisionTime };
}

