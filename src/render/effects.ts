import type { Effect } from '../game/types.ts';
import type { Point } from '../game/geometry.ts';

export function effectOrigin(effect: Effect, electron: Point): Point {
  if (effect.anchor === 'electron') return electron;
  return effect.from;
}

export function visibleEffects(effects: Effect[], reduced: boolean): Effect[] {
  const limits: Record<string, number> = {
    primary: reduced ? 6 : 12,
    chain: reduced ? 10 : 18,
    pierce: 3,
    burst: 6,
    strike: reduced ? 3 : 8,
    orb: reduced ? 6 : 12,
    bridge: reduced ? 3 : 5,
    charge: reduced ? 4 : 10,
    stun: reduced ? 4 : 8,
    surge: 1,
    return: reduced ? 5 : 10,
    focus: reduced ? 4 : 8,
    kill: reduced ? 3 : 8,
    level: 2,
    upgrade: 1,
    absorb: 4,
  };
  const counts: Record<string, number> = {};
  const beams = new Set<string>();
  return [...effects]
    .reverse()
    .filter((effect) => {
      if (
        ['focus', 'orb', 'bridge', 'charge'].includes(effect.kind) &&
        effect.targetId !== undefined
      ) {
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
