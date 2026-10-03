import type { Effect } from './game.ts';
import { satellitePosition } from './geometry.ts';
import type { Point } from './geometry.ts';

export function effectOrigin(effect: Effect, electron: Point, time: number): Point {
  if (effect.anchor === 'electron') return electron;
  if (effect.anchor) return satellitePosition(electron, effect.anchor.satellite, effect.anchor.count, time);
  return effect.from;
}

export function visibleEffects(effects: Effect[], reduced: boolean): Effect[] {
  const limits: Record<string, number> = { primary: reduced ? 6 : 12, satellite: reduced ? 4 : 8, chain: reduced ? 10 : 24, pierce: 3, area: 4, burst: 4, kill: reduced ? 3 : 10, level: 2, absorb: 4 };
  const counts: Record<string, number> = {};
  return [...effects].reverse().filter(effect => {
    const key = effect.kind === 'bolt' ? effect.source === 'chain' ? 'chain' : effect.source === 'satellite' ? 'satellite' : 'primary' : effect.kind;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts[key] <= limits[key];
  }).reverse();
}
