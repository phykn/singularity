import type { Effect } from './game.ts';
import type { Point } from './geometry.ts';

export function effectOrigin(effect: Effect, electron: Point): Point {
  if (effect.anchor === 'electron') return electron;
  return effect.from;
}

export function visibleEffects(effects: Effect[], reduced: boolean): Effect[] {
  const limits: Record<string, number> = { primary: reduced ? 6 : 12, chain: reduced ? 10 : 18, pierce: 3, area: 2, burst: 6, strike: reduced ? 3 : 8, wave: 1, whip: 1, focus: 1, kill: reduced ? 3 : 6, level: 2, absorb: 4 };
  const counts: Record<string, number> = {};
  return [...effects].reverse().filter(effect => {
    const key = effect.kind === 'bolt' ? ['chain', 'burst'].includes(effect.source ?? '') ? effect.source! : 'primary' : effect.kind;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts[key] <= limits[key];
  }).reverse();
}
