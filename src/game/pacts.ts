import type { Attack, Combat } from './combat.ts';
import { ahead, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import type { PactId } from './rules.ts';
import { closest } from './targeting.ts';
import type { Target } from './types.ts';

// What the eight pacts do to combat. Greed's spawn rate and XP live with spawning and growth.
export class Pacts {
  private readonly combat: Combat;
  // Overheat: the kill chain and the cool-down it ends in.
  private streak = 0;
  private lastKill = -Infinity;
  private pausedUntil = 0;
  // Quiet: basic shots held for the next release.
  private banked = 0;
  private nextRelease = 0;
  private drawnTrail = -Infinity;
  private nextHorizon = 0;

  constructor(combat: Combat) {
    this.combat = combat;
  }

  private get owned() {
    return this.combat.game.growth.pacts;
  }
  private get rules() {
    return this.combat.game.rules.pacts;
  }

  // Overheat: chained kills raise the attack rate until the chain breaks.
  get heatScale(): number {
    return this.owned.overheat ? 1 + this.streak * this.rules.overheat.rateStep : 1;
  }
  // Attacks stop while Overheat cools down.
  get cooling(): boolean {
    return this.combat.game.time < this.pausedUntil;
  }

  clear(): void {
    this.streak = 0;
  }

  sign(id: PactId): void {
    if (id === 'horizon') this.nextHorizon = this.combat.game.time + this.rules.horizon.massSeconds;
  }

  // Overheat: when the kill chain breaks, attacks stop to cool down.
  cool(): void {
    const g = this.combat.game,
      cfg = this.rules.overheat;
    if (!this.owned.overheat || !this.streak || g.time - this.lastKill <= cfg.windowSeconds) return;
    this.pausedUntil = g.time + this.streak * cfg.coolSeconds;
    this.streak = 0;
  }

  heat(): void {
    if (!this.owned.overheat) return;
    this.streak = Math.min(this.rules.overheat.maxStacks, this.streak + 1);
    this.lastKill = this.combat.game.time;
  }

  // Quiet: a basic shot is held instead of fired; reports whether one was due.
  bank(): boolean {
    const g = this.combat.game;
    if (!this.combat.within(g.position, this.combat.range).length) return false;
    this.banked++;
    return true;
  }

  // Quiet: held shots go out together on a fixed beat.
  release(): void {
    const c = this.combat,
      g = c.game,
      cfg = this.rules.quiet;
    if (!this.owned.quiet || !g.combatEnabled || g.time + 1e-8 < this.nextRelease) return;
    this.nextRelease = g.time + cfg.periodSeconds;
    if (!this.banked) return;
    const shots = this.banked * g.growth.values.multi.count,
      reach = closest(g.targets, g.position, shots, c.range).length;
    this.banked = 0;
    if (!reach) return;
    c.fireBasic(g.position, (cfg.damage * shots) / reach, reach);
    g.log('release', { shots });
  }

  // Overclock: a current stays on the orbit just behind the electron.
  current(): void {
    const c = this.combat,
      g = c.game;
    if (!this.owned.overclock || !g.combatEnabled) return;
    const cfg = this.rules.overclock,
      sweep = (cfg.trailAngle * Math.PI) / 180,
      start = g.angle - sweep,
      attack = { ...c.begin(undefined, cfg.damage), depth: 1 };
    if (g.time - this.drawnTrail >= 0.1) {
      this.drawnTrail = g.time;
      g.addEffect({
        kind: 'trail',
        from: orbit(start, g.radius),
        to: g.position,
        radius: g.radius,
        width: cfg.width,
        life: 0.15,
        arc: { start, sweep },
      });
    }
    for (const target of g.targets) {
      if (target.hp <= 0 || g.time < (target.trailReady ?? 0)) continue;
      const margin = cfg.width / 2 + target.size / 2;
      if (ahead(target.angle, start) > sweep || Math.abs(target.radius - g.radius) > margin)
        continue;
      target.trailReady = g.time + cfg.zapSeconds;
      c.deal(attack, target, attack.damage);
    }
  }

  // Horizon: the core gains one mass every `massSeconds`.
  horizon(): void {
    const g = this.combat.game;
    if (!this.owned.horizon || !g.combatEnabled || g.time + 1e-8 < this.nextHorizon) return;
    this.nextHorizon = g.time + this.rules.horizon.massSeconds;
    g.mass++;
  }

  // Horizon and Blast scale every hit; Gamble trades normal hits for harder criticals.
  scale(damage: number): number {
    if (this.owned.horizon) damage *= 1 + this.combat.game.mass * this.rules.horizon.damagePerMass;
    if (this.owned.blast) damage *= this.rules.blast.damageScale;
    return damage;
  }
  critical(damage: number, crit: boolean): number {
    const cfg = this.combat.game.rules;
    if (crit)
      return (
        damage * (this.owned.gamble ? this.rules.gamble.critMultiplier : cfg.combat.crit.multiplier)
      );
    return this.owned.gamble ? damage * this.rules.gamble.normalScale : damage;
  }

  // Blast: a fired hit splashes the particles around it.
  splash(attack: Attack, target: Target, at: Point): void {
    if (!this.owned.blast || attack.depth !== 0) return;
    const c = this.combat,
      damage = attack.power * this.rules.blast.damage,
      child = c.derive(attack, attack.damage, 2);
    for (const other of closest(c.game.targets, at, 8, this.rules.blast.radius))
      if (other !== target) c.deal(child, other, damage);
  }
}
