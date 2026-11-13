import { Game } from '../src/game/Game.ts';
import { CENTER } from '../src/game/geometry.ts';
import { rules } from '../src/game/rules.ts';
import type { ParticleKind } from '../src/game/rules.ts';
import type { Ranks } from '../src/game/skills.ts';
import type { Target } from '../src/game/types.ts';
import { Session } from '../src/session/Session.ts';
import type { SessionAudio } from '../src/session/Session.ts';

export const tickRate = rules.time.tickRate;

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

// A running game without regular arrivals or basic fire, with the given ranks and targets.
// The electron starts at the top of the orbit, (180, 128).
export function fixture(ranks: Partial<Ranks> = {}, targets: Target[] = []): Game {
  const g = new Game(42, { combat: false });
  g.start();
  Object.assign(g.growth.ranks, ranks);
  g.growth.refresh();
  g.targets = targets;
  return g;
}

// A plain hit of 10 on one particle, as a fired attack.
export const strike = (g: Game, t: Target) =>
  g.combat.deal({ power: 10, damage: 10, range: 99, depth: 0, budget: { burst: false } }, t, 10);

export const logged = <K extends Game['events'][number]['kind']>(g: Game, kind: K) =>
  g.events.filter((e): e is Extract<Game['events'][number], { kind: K }> => e.kind === kind);
export const fired = (g: Game, id: string) =>
  logged(g, 'skill-effect').some((e) => e.data.id === id);

// Takes the automatic card for every offer, as the paused-choice bot does.
export function pick(g: Game): void {
  for (let choice = g.growth.choice; choice; choice = g.growth.choice) {
    const card = g.growth.automaticCard;
    if (!card || !g.choose(card.id, choice.number)) break;
  }
}

// Plays automatic picks until the result (or `limit` seconds of ticks).
export function finish(g: Game, limit = 1800): Game {
  g.start();
  while (g.phase !== 'result' && g.elapsedTicks < limit * tickRate) {
    g.run(tickRate, true);
    pick(g);
  }
  return g;
}

// A ready session on seed 7 whose audio and hooks append what they did to `log`.
export function session(sound = true) {
  const log: string[] = [];
  const audio: SessionAudio = {
    enabled: false,
    unlock: async () => (log.push('unlock'), true),
    suspend: () => log.push('suspend'),
    update: () => {},
    play: (kind) => log.push(kind),
    destroy: () => {},
  };
  const s = new Session(new Game(7), audio, {
    sound: () => sound,
    audioFailed: () => log.push('failed'),
    record: () => log.push('record'),
    redraw: () => {},
  });
  s.setReady(true, 0);
  return { s, log };
}
