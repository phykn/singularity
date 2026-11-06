import { distance } from './geometry.ts';
import type { Point } from './geometry.ts';
import { closest } from './targeting.ts';
import { critChance } from './rules.ts';
import type { Game } from './Game.ts';
import type { Target } from './types.ts';

export class Combat {
  private readonly game: Game;
  private nextAttack: number;

  constructor(game: Game) {
    this.game = game;
    this.nextAttack = game.attackInterval * game.rules.time.tickRate;
  }

  update(): void {
    const g = this.game;
    if (!g.combatEnabled || g.tick + 1e-8 < this.nextAttack) return;
    if (!this.fireBasic()) return;
    // Regular fire keeps its fractional cadence; an attack that waited idle starts afresh.
    const at = g.tick - this.nextAttack < 1 + 1e-8 ? this.nextAttack : g.tick;
    this.nextAttack = at + g.attackInterval * g.rules.time.tickRate;
  }

  fireBasic(origin: Point = this.game.position): boolean {
    const g = this.game,
      target = closest(g.targets, origin, 1, g.range)[0];
    if (!target) return false;
    g.addEffect({
      kind: 'bolt',
      from: origin,
      to: target,
      radius: 0,
      width: 1.8,
      life: 0.14,
      anchor: 'electron',
      targetId: target.id,
      damage: g.damage,
    });
    this.deal(target, g.damage);
    return true;
  }

  deal(target: Target, base: number): void {
    const g = this.game,
      crit = g.critRoll() < critChance(g.boosts.crit, g.rules);
    g.damageTarget(target, crit ? base * g.rules.combat.crit.multiplier : base, crit);
  }

  reaches(origin: Point, range: number): boolean {
    return this.game.targets.some((t) => t.hp > 0 && distance(t, origin) <= range);
  }
}
