import { z } from 'zod';
import { Game } from './game.ts';
import type { Result } from './game.ts';
import { rules, skillIds, statIds } from './rules.ts';
import type { Language } from './i18n.ts';

export type Settings = { sound: boolean; reduced: boolean };
export type Record = Pick<Result, 'version' | 'outcome' | 'xp' | 'level' | 'speed' | 'seed' | 'collisionTime'>;
export const settingsKey = 'critical-point.settings.v1';
export const recordKey = 'critical-point.record.v7';
export const languageKey = 'singularity.language.v1';
export const runKey = 'singularity.run.v7';
const legacyRunKey = 'singularity.run.v6';

const checkpointSchema = z.object({
  version: z.union([z.literal(6), z.literal(rules.designVersion)]), seed: z.number().int().min(0).max(0xffffffff),
  ticks: z.number().int().min(0).max((rules.growthSeconds + rules.collisionSeconds + rules.successEndingSeconds) * rules.tickRate),
  phase: z.enum(['running', 'collapse', 'ending', 'result']), manualPaused: z.boolean(),
  inputs: z.array(z.object({ tick: z.number().int().min(0).max(rules.growthSeconds * rules.tickRate), id: z.enum([...skillIds, ...statIds]), number: z.number().int().min(1).max(rules.levelXp.length) })).max(rules.levelXp.length),
});

export function readRun(storage: Storage): Game | null {
  try {
    const checkpoint = checkpointSchema.safeParse(JSON.parse(storage.getItem(runKey) ?? storage.getItem(legacyRunKey) ?? 'null'));
    return checkpoint.success ? Game.restore(checkpoint.data) : null;
  } catch { return null; }
}

export function saveRun(storage: Storage, game: Game): boolean {
  const checkpoint = game.checkpoint();
  if (checkpoint) {
    const saved = save(storage, runKey, checkpoint);
    if (saved) { try { storage.removeItem(legacyRunKey); } catch { return false; } }
    return saved;
  }
  try { storage.removeItem(runKey); storage.removeItem(legacyRunKey); return true; }
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
    if (value?.version !== rules.designVersion || !['success', 'collapse-failure'].includes(value.outcome)) return null;
    if (!['xp', 'level', 'seed'].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
    if (!Number.isFinite(value.speed) || value.speed < rules.baseSpeed || !Number.isFinite(value.collisionTime) || value.collisionTime < 0 || value.collisionTime > rules.growthSeconds) return null;
    if (value.level < 1 || value.level > rules.levelXp.length + 1 || value.seed > 0xffffffff) return null;
    return value;
  } catch { return null; }
}
export function save(storage: Storage, key: string, value: unknown): boolean {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function bestRecord(current: Record | null, result: Result): Record | null {
  if (current?.version !== rules.designVersion) current = null;
  if (result.version !== rules.designVersion) return current;
  const score = (record: Record) => [Number(record.outcome === 'success'), record.xp, record.collisionTime];
  if (current?.version === rules.designVersion) {
    const old = score(current), next = score(result);
    const different = old.findIndex((value, i) => value !== next[i]);
    if (different < 0 || old[different] > next[different]) return current;
  }
  const { version, outcome, xp, level, speed, seed, collisionTime } = result;
  return { version, outcome, xp, level, speed, seed, collisionTime };
}

