import type { Effect } from '../game/types.ts';
import type { Point } from '../game/geometry.ts';

export const effectRows = { hit: 0, impact: 1, orb: 2, charge: 3, surge: 4, dissolve: 5 } as const;
export type EffectSprite = keyof typeof effectRows;
export type EffectStamp = (
  id: EffectSprite,
  point: Point,
  progress: number,
  color: number,
  alpha: number,
) => void;

export const beamRows = {
  basic: 0,
  chain: 1,
  pierce: 2,
  strike: 3,
  focus: 4,
  charge: 5,
  bridge: 6,
  return: 7,
} as const;
export type BeamId = keyof typeof beamRows;
export type BeamStamp = (
  id: BeamId,
  from: Point,
  to: Point,
  progress: number,
  color: number,
  alpha: number,
  height: number,
) => void;

export function beamFrame(id: BeamId, progress: number): number {
  return beamRows[id] * 4 + (Math.floor(Math.max(0, progress) * 12) % 4);
}

export function beamPose(from: Point, to: Point) {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    length: Math.hypot(to.x - from.x, to.y - from.y),
    angle: Math.atan2(to.y - from.y, to.x - from.x),
  };
}

export function effectFrame(id: EffectSprite, progress: number): number {
  const loop = id === 'orb' || id === 'charge' || id === 'surge';
  const frame = loop
    ? Math.floor(Math.max(0, progress) * (id === 'charge' ? 8 : 10)) % 4
    : Math.min(3, Math.floor(Math.max(0, progress) * 4));
  return effectRows[id] * 4 + frame;
}

export function effectOrigin(effect: Effect, electron: Point): Point {
  if (effect.anchor === 'electron') return electron;
  return effect.from;
}
export function visibleEffects(effects: Effect[]): Effect[] {
  const limits: Record<string, number> = {
    primary: 12,
    chain: 18,
    pierce: 3,
    burst: 6,
    strike: 8,
    bridge: 5,
    charge: 1,
    stun: 8,
    surge: 1,
    return: 10,
    focus: 8,
    kill: 8,
    level: 2,
    upgrade: 1,
    absorb: 4,
  };
  const counts: Record<string, number> = {};
  const beams = new Set<string>();
  return [...effects]
    .reverse()
    .filter((effect) => {
      if (['focus', 'bridge', 'charge'].includes(effect.kind) && effect.targetId !== undefined) {
        const key = effect.kind + effect.targetId;
        if (beams.has(key)) return false;
        beams.add(key);
      }
      const key =
        effect.kind === 'bolt'
          ? ['chain', 'burst'].includes(effect.source ?? '')
            ? effect.source!
            : 'primary'
          : effect.kind;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts[key] <= limits[key];
    })
    .reverse();
}
