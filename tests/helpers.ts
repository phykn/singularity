import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { particleIds } from '../src/game/particles.ts';
import type { Target, TargetKind } from '../src/game/types.ts';
import { rules } from '../src/game/rules.ts';
import type { Ranks, Rarity, UpgradeId } from '../src/game/rules.ts';
export const close = (a: number, b: number, error = 1e-7) =>
  assert.ok(Math.abs(a - b) < error, a + ' != ' + b);

export function target(
  id: number,
  x: number,
  y: number,
  hp = 2,
  kind: TargetKind = 'small',
): Target {
  const data = rules.targets[kind];
  return {
    id,
    x,
    y,
    hp,
    maxHp: hp,
    kind,
    particle: kind === 'small' ? 'quark' : 'proton',
    born: 0,
    xp: data.xp,
    mass: data.mass,
    size: data.size,
    radius: Math.hypot(x - 180, y - 260),
    angle: Math.atan2(y - 260, x - 180),
    speed: 0,
    turn: 0,
  };
}

export function fixture(ranks: Partial<Ranks> = {}, targets: Target[] = []): Game {
  const g = new Game(42, { combat: false });
  g.start();
  Object.assign(g.ranks, ranks);
  g.targets = targets;
  for (const id of particleIds)
    g.counts[id].generated = targets.filter((t) => t.particle === id).length;
  return g;
}

export function choose(g: Game, id: UpgradeId, rarity: Rarity = 'common'): void {
  g.choice = {
    number: g.selections.length + 1,
    opened: g.time,
    deadline: g.time + 8,
    cards: [{ id, rarity }],
  };
  assert.ok(g.select(id));
}

export function run(seed: number, fps: number): Game {
  const g = new Game(seed);
  g.start();
  for (let i = 0; i < fps * 1800 && !g.result; i++) g.advance(1000 / fps);
  assert.ok(g.result);
  return g;
}

export function stationarySkill(ranks: Partial<Ranks>, targets: Target[]): Game {
  const game = new Game(42, { combat: false, rules: { ...rules, baseSpeed: 0 } });
  game.start();
  Object.assign(game.ranks, ranks);
  game.targets = targets;
  game.counts.quark.generated = targets.length;
  return game;
}
