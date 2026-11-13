import type { Attack, Combat } from './combat.ts';
import { TAU, ahead, at, distance } from './geometry.ts';
import type { Point } from './geometry.ts';
import { timedSkills } from './skills.ts';
import type { TimedSkill } from './skills.ts';
import { closest, onSegment } from './targeting.ts';
import type { Target } from './types.ts';

// Skills on their own timer: Thunderstrike, Satellite, Charged Bolt and Static Field.
export class Timed {
  // The tick each skill next fires; never, until it is learned.
  next: Record<TimedSkill, number> = {
    strike: Infinity,
    satellite: Infinity,
    spark: Infinity,
    field: Infinity,
  };
  private readonly combat: Combat;
  private nextStorm = 0;
  private stormTurn = 0;

  constructor(combat: Combat) {
    this.combat = combat;
  }

  period(id: TimedSkill): number {
    const g = this.combat.game;
    return (g.rules.skills[id].periodSeconds / this.combat.rate) * g.rules.time.tickRate;
  }

  // A timed skill fires on the tick after it is first taken.
  learn(id: TimedSkill): void {
    const g = this.combat.game;
    if (g.growth.ranks[id] === 1) this.next[id] = g.tick + 1;
  }

  rescale(stretch: (at: number) => number): void {
    this.nextStorm = stretch(this.nextStorm);
    for (const id of timedSkills)
      if (Number.isFinite(this.next[id])) this.next[id] = stretch(this.next[id]);
  }

  fireDue(): void {
    const tick = this.combat.game.tick;
    for (const id of timedSkills)
      if (this.next[id] <= tick + 1e-8 && this.fire(id)) this.next[id] = tick + this.period(id);
  }

  // Reports whether anything was in reach; a skill that found nothing tries again next tick.
  fire(id: TimedSkill): boolean {
    const c = this.combat,
      g = c.game,
      { ranks, values } = g.growth;
    if (!ranks[id] || !g.targets.length) return false;
    const attack = c.begin(id, values[id].damage);
    if (id === 'satellite') return this.fireSatellite(attack);
    if (id === 'spark') return this.fireSpark(attack);
    if (id === 'field') return this.fireField(attack);
    const targets = c.strongest(
      g.position,
      values.strike.range,
      values.strike.count + values.multi.count - 1,
    );
    if (!targets.length) return false;
    c.volley(attack, g.position, targets, true);
    c.activate('strike');
    this.thunder(attack, targets);
    return true;
  }

  // Thunderstrike at rank 5: one more bolt joins every impact point.
  private thunder(attack: Attack, targets: Target[]): void {
    const c = this.combat,
      g = c.game,
      cfg = g.rules.skills.strike.thunder;
    g.log('thunder', { count: targets.length });
    if (g.growth.ranks.strike < g.rules.growth.maxRank || targets.length < 2) return;
    const link = c.derive(attack, attack.damage * cfg.damage, 2),
      hit = new Set<number>();
    for (let i = 1; i < targets.length; i++) {
      const from = targets[i - 1],
        to = targets[i];
      c.effect(link, 'bolt', from, to, { life: 0.22, source: 'strike', width: 2.4 });
      for (const target of onSegment(g.targets, from, to, cfg.width)) {
        if (hit.has(target.id)) continue;
        hit.add(target.id);
        c.deal(link, target, link.damage);
      }
    }
  }

  // Evolved Thunderstrike: bolts keep falling between the regular strikes.
  storm(): void {
    const c = this.combat,
      g = c.game,
      { ranks, values, evolved } = g.growth;
    if (!evolved.strike || !ranks.strike || g.tick + 1e-8 < this.nextStorm) return;
    const cfg = g.rules.skills.strike.evolution;
    this.nextStorm = g.tick + (cfg.stormSeconds / c.rate) * g.rules.time.tickRate;
    const pool = c.strongest(g.position, values.strike.range, 3);
    if (!pool.length) return;
    const target = pool[this.stormTurn++ % pool.length];
    c.emit(c.begin('strike', values.strike.damage * cfg.damage), g.position, target, false);
  }

  // Charged Bolt: sparks scatter, one per direction around the electron, popping in turn.
  private fireSpark(attack: Attack): boolean {
    const c = this.combat,
      g = c.game,
      s = g.growth.values.spark,
      origin = g.position,
      near = c.within(origin, s.range);
    if (!near.length) return false;
    const turn = g.time * 1.7,
      sectors = new Map<number, Target>();
    for (const t of near) {
      const sector = Math.floor(
          ahead(Math.atan2(t.y - origin.y, t.x - origin.x), turn) / (TAU / s.count),
        ),
        best = sectors.get(sector);
      if (!best || distance(t, origin) < distance(best, origin)) sectors.set(sector, t);
    }
    const chosen = [...sectors.values()];
    for (const t of closest(near, origin, s.count, s.range, new Set(chosen.map((t) => t.id))))
      if (chosen.length < s.count) chosen.push(t);
    const spark = { ...attack, depth: 1 };
    chosen.forEach((target, i) =>
      c.schedule(i * g.rules.skills.spark.popSeconds, () => this.spark(spark, target, origin)),
    );
    c.activate('spark');
    return true;
  }

  // Evolved: each spark bounces once to a nearby particle.
  private spark(attack: Attack, target: Target, from: Point): void {
    const c = this.combat,
      g = c.game,
      cfg = g.rules.skills.spark;
    if (!c.pop(attack, target, from) || !g.growth.evolved.spark || attack.spent) return;
    const next = closest(g.targets, target, 1, cfg.evolution.bounceRange, new Set([target.id]))[0];
    if (!next) return;
    const bounce = { ...attack, spent: true, damage: attack.damage * cfg.evolution.bounceDamage },
      origin = at(target);
    c.schedule(cfg.popSeconds * 2, () => this.spark(bounce, next, origin));
  }

  // Static Field: weak particles in the field pop together; giant particles lose a share
  // of health.
  private fireField(attack: Attack): boolean {
    const c = this.combat,
      g = c.game,
      s = g.growth.values.field,
      origin = g.position,
      targets = c.within(origin, s.radius);
    if (!targets.length) return false;
    const field = { ...attack, depth: 1 };
    c.effect(field, 'field', origin, origin, { radius: s.radius, life: 0.35, anchored: true });
    for (const target of targets) {
      const share = target.final ? g.rules.skills.field.finalScale : 1;
      c.deal(
        field,
        target,
        target.kind === 'boss' ? target.hp * s.bossFraction * share : field.damage,
      );
    }
    c.activate('field');
    return true;
  }

  // Evolved Static Field: a particle it pops leaves a small field behind.
  leaveRemnant(attack: Attack, point: Point): void {
    const c = this.combat,
      g = c.game,
      cfg = g.rules.skills.field.evolution,
      remnant = { ...attack, spent: true, depth: 2 };
    c.schedule(cfg.delaySeconds, () => {
      const damage = remnant.power * g.growth.values.field.damage * cfg.damage;
      c.effect(remnant, 'field', point, point, { radius: cfg.radius, life: 0.25 });
      for (const target of closest(g.targets, point, 12, cfg.radius))
        c.deal({ ...remnant, damage }, target, damage);
    });
  }

  private fireSatellite(attack: Attack): boolean {
    const c = this.combat,
      g = c.game,
      { values, evolved } = g.growth,
      branches = values.multi.count,
      reserved = new Set<number>();
    let fired = 0;
    for (const [index, point] of c.satellites.entries()) {
      // Satellites spread over different particles before sharing one.
      const targets = closest(g.targets, point, branches, values.satellite.range, reserved);
      if (targets.length < branches) {
        const shared = g.targets.filter((t) => reserved.has(t.id));
        targets.push(...closest(shared, point, branches - targets.length, values.satellite.range));
      }
      targets.forEach((t) => reserved.add(t.id));
      fired += c.volley(
        { ...attack, satellite: index, range: values.satellite.range },
        point,
        targets,
        index,
      );
    }
    if (fired && evolved.satellite) this.ring(attack);
    if (fired) c.activate('satellite');
    return fired > 0;
  }

  // Evolved Satellite: the satellites are joined into a ring of current.
  private ring(attack: Attack): void {
    const c = this.combat,
      g = c.game,
      cfg = g.rules.skills.satellite.evolution,
      points = c.satellites,
      ring = c.derive(attack, attack.damage * cfg.ringDamage, 2),
      hit = new Set<number>();
    if (points.length < 2) return;
    for (const [i, from] of points.entries()) {
      const to = points[(i + 1) % points.length];
      c.effect(ring, 'pierce', from, to, { source: 'satellite', width: cfg.width });
      for (const target of onSegment(g.targets, from, to, cfg.width)) {
        if (hit.has(target.id)) continue;
        hit.add(target.id);
        c.deal(ring, target, ring.damage);
      }
    }
  }
}
