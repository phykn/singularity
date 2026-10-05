import type { Effect } from '../game/types.ts';
import type { Point } from '../game/geometry.ts';
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
    charge: 10,
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
