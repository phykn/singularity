import { Game } from '../src/game/Game.ts';
import { CENTER } from '../src/game/geometry.ts';
import { rules } from '../src/game/rules.ts';
import type { Ranks } from '../src/game/rules.ts';
import type { ParticleKind } from '../src/game/particles.ts';
import type { Target } from '../src/game/types.ts';

// A still particle at (x, y); `particle` picks its family and values.
export function target(
  id: number,
  x: number,
  y: number,
  hp = 2,
  particle: ParticleKind = 'quark',
): Target {
  const p = rules.particles[particle];
  return {
    id,
    x,
    y,
    hp,
    maxHp: hp,
    kind: p.family,
    particle,
    born: 0,
    xp: p.xp,
    mass: p.mass,
    size: p.size,
    radius: Math.hypot(x - CENTER.x, y - CENTER.y),
    angle: Math.atan2(y - CENTER.y, x - CENTER.x),
    speed: 0,
    turn: 0,
  };
}

// A running game with spawning off, the given ranks and only the given targets.
export function fixture(ranks: Partial<Ranks> = {}, targets: Target[] = []): Game {
  const g = new Game(42, { combat: false });
  g.start();
  Object.assign(g.ranks, ranks);
  g.targets = targets;
  return g;
}

// Runs a game until its result (or `limit` seconds of ticks).
export function finish(g: Game, limit = 1800): Game {
  if (g.phase === 'ready') g.start();
  const tickRate = g.rules.time.tickRate;
  while (g.phase !== 'result' && g.elapsedTicks < limit * tickRate) g.run(tickRate);
  return g;
}
