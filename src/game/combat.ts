import { timedSkills } from './skills.ts';
import type { SkillValues, TimedSkill } from './skills.ts';
import { CENTER, distance, norm, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { closest, onSegment } from './targeting.ts';
import { critChance } from './rules.ts';
import type { Ranks, Rarities, SkillId, UpgradeId } from './rules.ts';
import type { Effect, SkillStatus, Target } from './types.ts';
import type { Game } from './Game.ts';

type Anchor = boolean | number;

export type Attack = {
  id: number;
  ranks: Ranks;
  rarities: Rarities;
  evolved: Partial<Record<SkillId, boolean>>;
  forms: SkillValues;
  power: number;
  damage: number;
  range: number;
  firstKill?: Point;
  source?: SkillId;
  depth: number;
  budget: { burst: boolean };
  satellite?: number;
  // Fission generation; each split goes one deeper until the rank's limit.
  generation?: number;
  // Extra Repeat hits already added by kills (evolved Repeat).
  extra?: number;
  // A spark that already bounced, an echo that already returned, a field remnant.
  spent?: boolean;
};
type Pulse = {
  at: number;
  order: number;
  attack: Attack;
  target?: Target;
  from?: Point;
  reverse?: Point;
  // Evolved Return: the bolt goes back out from the electron to `reverse`.
  outward?: boolean;
  // A delayed single hit that lets a group of particles pop one after another.
  pop?: boolean;
  fission?: Point;
  remnant?: Point;
  overcharge?: number;
  anchored: Anchor;
};
type Trail = {
  attack: Attack;
  from: Point;
  to: Point;
  width: number;
  until: number;
  next: number;
};

const ahead = (angle: number, from: number) =>
  (((angle - from) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

export class Combat {
  private readonly game: Game;
  activations: Partial<Record<SkillId, number>> = {};
  private firedAt: Partial<Record<SkillId, number>> = {};
  private nextLinked: Partial<Record<SkillId, number>> = {};
  private nextAttack: number;
  private nextId = 0;
  private order = 0;
  private nextSkill: Record<TimedSkill, number> = {
    strike: Infinity,
    satellite: Infinity,
    spark: Infinity,
    field: Infinity,
  };
  private pulses: Pulse[] = [];
  private trails: Trail[] = [];
  private surgeCharge = 0;
  private storedCharge = 0;
  private lastSurgeCharge = -Infinity;
  private nextSurgeHit = 0;
  private surgeUntil = 0;
  private surgeExtended = 0;
  private nextSurge = 0;
  private surgeAttack?: Attack;
  private marked = new Set<number>();
  private heat = 0;
  private nextStorm = 0;
  private stormTurn = 0;
  // Pacts
  private streak = 0;
  private lastKill = -Infinity;
  private pausedUntil = 0;
  private banked = 0;
  private nextRelease = 0;
  private drawnTrail = -Infinity;

  constructor(game: Game) {
    this.game = game;
    this.nextAttack = game.rules.attackBaseSeconds * game.rules.tickRate;
  }

  get satellitePoints(): readonly Point[] {
    const g = this.game,
      count = g.forms.satellite.count;
    return Array.from({ length: count }, (_, i) => {
      const angle = g.time * g.rules.skills.satellite.angularSpeed + (i * Math.PI * 2) / count;
      return {
        x: g.position.x + Math.cos(angle) * g.rules.skills.satellite.orbitRadius,
        y: g.position.y + Math.sin(angle) * g.rules.skills.satellite.orbitRadius,
      };
    });
  }

  // Overheat: chained kills raise the attack rate until the chain breaks.
  get heatScale(): number {
    return this.game.pacts.overheat ? 1 + this.streak * this.game.rules.pacts.overheat.rateStep : 1;
  }

  update(): void {
    const g = this.game;
    const due = this.pulses
      .filter((p) => p.at <= g.tick + 1e-8)
      .sort((a, b) => a.at - b.at || a.order - b.order);
    this.pulses = this.pulses.filter((p) => p.at > g.tick + 1e-8);
    for (const pulse of due) {
      if (pulse.reverse) this.reverse(pulse.attack, pulse.reverse, pulse.outward);
      else if (pulse.pop) this.pop(pulse);
      else if (pulse.fission) this.split(pulse.attack, pulse.fission);
      else if (pulse.remnant) this.remnant(pulse.attack, pulse.remnant);
      else if (pulse.overcharge) this.overcharge(pulse.overcharge, true);
      else this.repeatHit(pulse);
    }
    this.updateOverheat();
    const held = g.time < this.pausedUntil;
    if (g.combatEnabled && !held && g.tick + 1e-8 >= this.nextAttack) {
      const fired = g.pacts.quiet ? this.bank() : this.fireBasic();
      if (fired) {
        // Preserve fractional cadence during regular fire; an idle-ready attack
        // starts a new interval rather than accumulating overdue shots.
        const at = g.tick - this.nextAttack < 1 + 1e-8 ? this.nextAttack : g.tick;
        this.nextAttack = at + g.attackInterval * g.rules.tickRate;
      }
    }
    if (g.pacts.quiet && g.combatEnabled) this.release();
    for (const id of timedSkills) {
      if (held || this.nextSkill[id] > g.tick + 1e-8) continue;
      if (this.fireSkill(id)) this.nextSkill[id] = g.tick + this.interval(id);
    }
    this.updateStorm();
    this.updateTrails();
    this.updateCurrent();
    this.updateSurge();
  }

  status(id: SkillId): SkillStatus {
    const g = this.game,
      fired = g.phase === 'running' && g.time - (this.firedAt[id] ?? -1) < 0.16;
    if (id === 'surge')
      return {
        mode: 'charging',
        progress:
          this.surgeUntil > g.time
            ? 1
            : g.time - this.lastSurgeCharge > g.rules.skills.surge.windowSeconds
              ? 0
              : this.surgeCharge / g.forms.surge.kills,
        active: g.phase === 'running' && this.surgeUntil > g.time,
        fired,
      };
    if (id === 'charge')
      return {
        mode: 'charging',
        progress: Math.min(1, this.storedCharge / (g.forms.charge.threshold || 1)),
        active: false,
        fired,
      };
    if (id === 'mark')
      return {
        mode: 'charging',
        progress: Math.min(1, this.marked.size / g.forms.mark.threshold),
        active: false,
        fired,
      };
    if (id === 'overcharge')
      return {
        mode: 'charging',
        progress: Math.min(1, this.heat / g.forms.overcharge.kills),
        active: false,
        fired,
      };
    if (id === 'burst' || id === 'tempo' || id === 'fission')
      return { mode: 'conditional', progress: 0, active: false, fired };
    const timed = timedSkills.includes(id as TimedSkill),
      skill = id as TimedSkill;
    const interval = timed ? this.interval(skill) : g.attackInterval * g.rules.tickRate;
    const next = timed ? this.nextSkill[skill] : (this.nextLinked[id] ?? g.tick);
    return {
      mode: timed ? 'timed' : 'linked',
      progress: Math.max(0, Math.min(1, 1 - (next - g.tick) / interval)),
      active: false,
      fired,
    };
  }

  learn(id: UpgradeId, previous: number): void {
    if (id in this.nextSkill && previous === 0)
      this.nextSkill[id as TimedSkill] = this.game.tick + 1;
  }

  private interval(id: TimedSkill): number {
    const g = this.game;
    return (g.rules.skills[id].periodSeconds / g.rate) * g.rules.tickRate;
  }

  rescaleCooldowns(oldRate: number): void {
    const { tick, rate } = this.game,
      ratio = oldRate / rate;
    this.nextAttack = tick + Math.max(0, this.nextAttack - tick) * ratio;
    this.nextSurge = tick + Math.max(0, this.nextSurge - tick) * ratio;
    for (const id of Object.keys(this.nextLinked) as SkillId[])
      this.nextLinked[id] = tick + Math.max(0, this.nextLinked[id]! - tick) * ratio;
    for (const id of timedSkills)
      if (Number.isFinite(this.nextSkill[id]))
        this.nextSkill[id] = tick + Math.max(0, this.nextSkill[id] - tick) * ratio;
  }

  clear(): void {
    this.pulses = [];
    this.trails = [];
    this.surgeCharge = 0;
    this.storedCharge = 0;
    this.surgeUntil = 0;
    this.surgeAttack = undefined;
    this.marked.clear();
    this.heat = 0;
    this.streak = 0;
    this.banked = 0;
    for (const target of this.game.targets) {
      target.trailReady = 0;
      target.marked = false;
    }
  }

  reset(): void {
    this.clear();
    this.firedAt = {};
    this.nextLinked = {};
    this.lastSurgeCharge = -Infinity;
    this.lastKill = -Infinity;
    this.pausedUntil = 0;
    this.nextSurgeHit = 0;
    this.nextAttack = this.nextSurge = this.nextStorm = this.game.tick + 1;
    this.nextRelease = this.game.time + this.game.rules.pacts.quiet.periodSeconds;
    for (const id of timedSkills)
      this.nextSkill[id] = this.game.ranks[id] ? this.game.tick + 1 : Infinity;
  }

  // Called by Game for every particle that pops, with the attack that popped it.
  killed(target: Target, attack?: Attack): void {
    const g = this.game;
    this.chargeSurge(1);
    if (g.evolved.surge && g.time < this.surgeUntil) {
      const cfg = g.rules.evolution.surge,
        add = Math.min(cfg.extendSeconds, cfg.maxExtend - this.surgeExtended);
      if (add > 0) {
        this.surgeUntil += add;
        this.surgeExtended += add;
      }
    }
    if (g.pacts.overheat) {
      this.streak = Math.min(g.rules.pacts.overheat.maxStacks, this.streak + 1);
      this.lastKill = g.time;
    }
    const point = { x: target.x, y: target.y };
    if (g.ranks.overcharge && attack?.source !== 'overcharge') {
      this.heat++;
      if (this.heat >= g.forms.overcharge.kills) {
        this.heat = 0;
        this.overcharge(1);
      }
    }
    if (g.ranks.fission) {
      const generation = attack?.source === 'fission' ? (attack.generation ?? 0) : 0;
      const depth = g.forms.fission.depth + (g.pacts.greed ? g.rules.pacts.greed.depth : 0);
      if (generation < depth)
        this.pulses.push({
          at: g.tick + g.rules.skills.fission.delaySeconds * g.rules.tickRate,
          order: this.order++,
          attack: { ...this.begin('fission', g.forms.fission.damage), generation, depth: 2 },
          fission: point,
          anchored: false,
        });
    }
    if (attack?.source === 'field' && !attack.spent && g.evolved.field)
      this.pulses.push({
        at: g.tick + g.rules.evolution.field.delaySeconds * g.rules.tickRate,
        order: this.order++,
        attack: { ...attack, spent: true, depth: 2 },
        remnant: point,
        anchored: false,
      });
  }

  private chargeSurge(amount: number): void {
    const g = this.game;
    if (!g.ranks.surge || g.time < this.surgeUntil) return;
    if (g.time - this.lastSurgeCharge > g.rules.skills.surge.windowSeconds) this.surgeCharge = 0;
    this.lastSurgeCharge = g.time;
    this.surgeCharge += amount;
    const surge = g.forms.surge;
    if (this.surgeCharge < surge.kills) return;
    this.surgeCharge = 0;
    this.surgeUntil = g.time + surge.duration;
    this.surgeExtended = 0;
    this.nextSurge = g.tick + 1;
    this.surgeAttack = this.begin('surge', surge.damage);
    this.activate('surge');
    this.effect(
      this.surgeAttack,
      'surge',
      g.position,
      g.position,
      12,
      this.surgeUntil - g.time,
      true,
    );
  }

  fireBasic(origin: Point = this.game.position, multiplier = 1, count?: number): boolean {
    const range = this.game.range;
    if (!this.game.targets.some((t) => t.hp > 0 && distance(t, origin) <= range)) return false;
    const attack = this.begin(undefined, multiplier),
      limit = count ?? attack.forms.multi.count;
    const selected = closest(this.game.targets, origin, limit, attack.range);
    // Basic fire always answers the boss, so builds without single-target skills can still fight it.
    const boss = this.game.boss;
    if (boss && !selected.includes(boss) && distance(boss, origin) <= attack.range) {
      selected.unshift(boss);
      if (selected.length > limit) selected.length = limit;
    }
    this.volley(attack, origin, selected, true);
    return selected.length > 0;
  }

  // Quiet pact: basic shots are held and released together on a fixed beat.
  private bank(): boolean {
    const g = this.game;
    if (!g.targets.some((t) => t.hp > 0 && distance(t, g.position) <= g.range)) return false;
    this.banked++;
    return true;
  }

  private release(): void {
    const g = this.game;
    if (g.time + 1e-8 < this.nextRelease) return;
    this.nextRelease = g.time + g.rules.pacts.quiet.periodSeconds;
    if (!this.banked) return;
    const shots = this.banked * this.game.forms.multi.count,
      reach = closest(g.targets, g.position, shots, g.range).length;
    this.banked = 0;
    if (!reach) return;
    this.fireBasic(g.position, (g.rules.pacts.quiet.damage * shots) / reach, reach);
    g.log('release', { shots });
  }

  resonate(beat: 1 | 2 | 3): void {
    const g = this.game,
      cfg = g.rules.resonance,
      multiplier = beat === 3 ? cfg.finishDamage : cfg.beatDamage,
      attack = this.begin(undefined, multiplier);
    attack.power *= multiplier;
    if (beat !== 3) {
      this.volley(attack, g.position, closest(g.targets, g.position, 1, attack.range), true);
      return;
    }
    // One global hit per particle; modifier cascades stay on the first two beats.
    attack.depth = 2;
    for (const target of [...g.targets]) this.deal(attack, target, attack.damage);
  }

  // Tempo and the pulse pact: each accepted beat sweeps forward along the orbit, popping in order.
  sweep(beat: 1 | 2 | 3): void {
    const g = this.game;
    if (g.ranks.tempo) {
      const s = g.forms.tempo,
        whole = beat === 3 && g.evolved.tempo;
      // Evolved: the third beat sweeps the whole lap, a little softer per particle.
      const count = whole
        ? Infinity
        : s.count * (beat === 3 ? g.rules.skills.tempo.finishScale : 1);
      const damage = whole ? s.damage * g.rules.evolution.tempo.damage : s.damage;
      if (this.sweepOrbit('tempo', s.band, count, damage)) this.activate('tempo');
    }
    if (g.pacts.pulse) {
      const p = g.rules.pacts.pulse;
      this.sweepOrbit(undefined, g.forms.tempo.band || 24, p.count, p.damage);
    }
  }

  private sweepOrbit(source: SkillId | undefined, band: number, count: number, damage: number) {
    const g = this.game;
    const targets = g.targets
      .filter((t) => t.hp > 0 && t.radius <= g.radius + band)
      .sort((a, b) => ahead(a.angle, g.angle) - ahead(b.angle, g.angle) || a.id - b.id)
      .slice(0, count);
    if (!targets.length) return false;
    const attack = { ...this.begin(source, damage), depth: 2 };
    this.popInOrder(attack, g.position, targets, g.rules.skills.tempo.popSeconds);
    return true;
  }

  private popInOrder(attack: Attack, start: Point | undefined, targets: Target[], gap: number) {
    let from = start;
    for (const [i, target] of targets.entries()) {
      this.pulses.push({
        at: this.game.tick + i * gap * this.game.rules.tickRate,
        order: this.order++,
        attack,
        target,
        from: from && { ...from },
        anchored: false,
        pop: true,
      });
      if (from) from = { x: target.x, y: target.y };
    }
  }

  private pop(pulse: Pulse): void {
    const g = this.game,
      target = pulse.target!;
    if (target.hp <= 0 || !g.targets.includes(target)) return;
    if (pulse.from)
      this.effect(
        pulse.attack,
        'bolt',
        pulse.from,
        target,
        0,
        0.14,
        false,
        // Sparks keep their own colour; other pops read as plain arcs.
        pulse.attack.source === 'spark' ? 'spark' : undefined,
        1.3,
        target.id,
      );
    this.deal(pulse.attack, target, pulse.attack.damage);
    // Evolved Charged Bolt: each spark bounces once to a nearby particle.
    const attack = pulse.attack;
    if (attack.source === 'spark' && attack.evolved.spark && !attack.spent) {
      const cfg = g.rules.evolution.spark;
      const next = closest(g.targets, target, 1, cfg.bounceRange, new Set([target.id]))[0];
      if (next)
        this.pulses.push({
          at: g.tick + g.rules.skills.spark.popSeconds * 2 * g.rules.tickRate,
          order: this.order++,
          attack: { ...attack, spent: true, damage: attack.damage * cfg.bounceDamage },
          target: next,
          from: { x: target.x, y: target.y },
          anchored: false,
          pop: true,
        });
    }
  }

  private repeatHit(pulse: Pulse): void {
    const g = this.game;
    const from =
      typeof pulse.anchored === 'number'
        ? (this.satellitePoints[pulse.anchored] ?? pulse.from!)
        : pulse.anchored
          ? g.position
          : pulse.from!;
    const target =
      pulse.target && pulse.target.hp > 0 && g.targets.includes(pulse.target)
        ? pulse.target
        : closest(g.targets, from, 1, pulse.attack.range)[0];
    if (!target) return;
    this.emit(pulse.attack, from, target, pulse.anchored, true);
    this.activate('repeat');
    // Evolved Repeat: a kill adds one more hit, so the stream continues while kills continue.
    const extra = pulse.attack.extra ?? 0;
    if (target.hp <= 0 && pulse.attack.evolved.repeat && extra < g.rules.evolution.repeat.maxExtra)
      this.pulses.push({
        ...pulse,
        at: g.tick + g.rules.skills.repeat.delaySeconds * g.rules.tickRate,
        order: this.order++,
        attack: { ...pulse.attack, extra: extra + 1 },
        target: undefined,
      });
  }

  fireSkill(id: TimedSkill, origin: Point = this.game.position): boolean {
    const g = this.game;
    if (!g.ranks[id] || !g.targets.length) return false;
    const attack = this.begin(id),
      s = attack.forms;
    attack.damage *= s[id].damage;
    if (id === 'satellite') return this.fireSatellite(attack);
    if (id === 'spark') return this.fireSpark(attack, origin);
    if (id === 'field') return this.fireField(attack, origin);
    const targets = this.strongest(origin, s.strike.range, s.strike.count + s.multi.count - 1);
    this.volley(attack, origin, targets, true);
    if (!targets.length) return false;
    this.activate('strike');
    this.thunder(attack, targets);
    return true;
  }

  private strongest(origin: Point, range: number, count: number): Target[] {
    return this.within(origin, range)
      .sort((a, b) => b.maxHp - a.maxHp || a.hp - b.hp || a.radius - b.radius || a.id - b.id)
      .slice(0, count);
  }

  private within(origin: Point, range: number): Target[] {
    return this.game.targets.filter((t) => t.hp > 0 && distance(t, origin) <= range);
  }

  // Thunderstrike at rank 5: the last bolt joins every impact point.
  private thunder(attack: Attack, targets: Target[]): void {
    const g = this.game;
    g.log('thunder', { count: targets.length });
    if (attack.ranks.strike < g.rules.maxRank || targets.length < 2) return;
    const cfg = g.rules.skills.strike.thunder,
      link = { ...attack, damage: attack.damage * cfg.damage, depth: 2, firstKill: undefined };
    const points = targets.map((t) => ({ x: t.x, y: t.y }));
    const hit = new Set<number>();
    for (let i = 1; i < points.length; i++) {
      this.effect(link, 'bolt', points[i - 1], points[i], 0, 0.22, false, 'strike', 2.4);
      for (const target of onSegment(g.targets, points[i - 1], points[i], cfg.width)) {
        if (hit.has(target.id)) continue;
        hit.add(target.id);
        this.deal(link, target, link.damage);
      }
    }
  }

  // Evolved Thunderstrike: bolts keep falling between the regular strikes.
  private updateStorm(): void {
    const g = this.game;
    if (!g.evolved.strike || !g.ranks.strike || g.tick + 1e-8 < this.nextStorm) return;
    const cfg = g.rules.evolution.strike;
    this.nextStorm = g.tick + (cfg.stormSeconds / g.rate) * g.rules.tickRate;
    const pool = this.strongest(g.position, g.forms.strike.range, 3);
    if (!pool.length) return;
    const target = pool[this.stormTurn++ % pool.length];
    const attack = this.begin('strike', g.forms.strike.damage * cfg.damage);
    this.emit(attack, g.position, target, false);
  }

  private fireSpark(attack: Attack, origin: Point): boolean {
    const g = this.game,
      s = attack.forms.spark;
    const near = this.within(origin, s.range);
    if (!near.length) return false;
    // One spark per direction around the electron, so the sparks scatter.
    const turn = g.time * 1.7,
      sectors = new Map<number, Target>();
    for (const t of near) {
      const sector = Math.floor(
        ahead(Math.atan2(t.y - origin.y, t.x - origin.x), turn) / ((Math.PI * 2) / s.count),
      );
      const best = sectors.get(sector);
      if (!best || distance(t, origin) < distance(best, origin)) sectors.set(sector, t);
    }
    const chosen = [...sectors.values()];
    for (const t of closest(near, origin, s.count, s.range, new Set(chosen.map((c) => c.id))))
      if (chosen.length < s.count) chosen.push(t);
    const spark = { ...attack, depth: 1 };
    for (const [i, target] of chosen.entries())
      this.pulses.push({
        at: g.tick + i * g.rules.skills.spark.popSeconds * g.rules.tickRate,
        order: this.order++,
        attack: spark,
        target,
        from: { ...origin },
        anchored: false,
        pop: true,
      });
    this.activate('spark');
    return true;
  }

  // Static Field: weak particles in the field pop together; giant particles lose a share of health.
  private fireField(attack: Attack, origin: Point): boolean {
    const g = this.game,
      s = attack.forms.field;
    const targets = this.within(origin, s.radius);
    if (!targets.length) return false;
    const field = { ...attack, depth: 1 };
    this.effect(field, 'field', origin, origin, s.radius, 0.35, true);
    for (const target of targets) {
      const damage =
        target.kind === 'boss'
          ? target.hp * s.bossFraction * (target.final ? g.rules.skills.field.finalScale : 1)
          : field.damage;
      this.deal(field, target, damage);
    }
    this.activate('field');
    return true;
  }

  private remnant(attack: Attack, at: Point): void {
    const g = this.game,
      cfg = g.rules.evolution.field;
    const damage = attack.power * attack.forms.field.damage * cfg.damage;
    this.effect(attack, 'field', at, at, cfg.radius, 0.25, false);
    for (const target of closest(g.targets, at, 12, cfg.radius))
      this.deal({ ...attack, damage }, target, damage);
  }

  // Fission: a popped particle takes its nearest neighbours with it.
  private split(attack: Attack, from: Point): void {
    const g = this.game,
      generation = (attack.generation ?? 0) + 1;
    const growth = attack.evolved.fission
      ? 1 + g.rules.evolution.fission.radiusGrowth * (generation - 1)
      : 1;
    const targets = closest(
      g.targets,
      from,
      g.rules.skills.fission.targets,
      attack.forms.fission.radius * growth,
    );
    if (!targets.length) return;
    const child = { ...attack, generation };
    for (const target of targets) {
      this.effect(child, 'bolt', from, target, 0, 0.14, false, 'fission', 1.3, target.id);
      this.deal(child, target, child.damage);
    }
    this.activate('fission');
  }

  // Overcharge: kills heat the electron until the whole orbit discharges at once.
  private overcharge(scale: number, echo = false): void {
    const g = this.game,
      s = g.forms.overcharge;
    const targets = g.targets
      .filter((t) => t.hp > 0 && Math.abs(t.radius - g.radius) <= s.band)
      .sort((a, b) => ahead(a.angle, g.angle) - ahead(b.angle, g.angle) || a.id - b.id);
    const attack = { ...this.begin('overcharge', s.damage * scale), depth: 2 };
    this.effect(attack, 'field', CENTER, CENTER, g.radius, 0.4, false);
    this.popInOrder(attack, undefined, targets, g.rules.skills.overcharge.popSeconds);
    this.activate('overcharge');
    if (!echo && g.evolved.overcharge) {
      const cfg = g.rules.evolution.overcharge;
      this.pulses.push({
        at: g.tick + cfg.delaySeconds * g.rules.tickRate,
        order: this.order++,
        attack,
        overcharge: cfg.damage,
        anchored: false,
      });
    }
  }

  private fireSatellite(attack: Attack): boolean {
    const g = this.game,
      s = attack.forms,
      branches = s.multi.count;
    let fired = 0;
    const reserved = new Set<number>();
    for (const [index, point] of this.satellitePoints.entries()) {
      const targets = closest(g.targets, point, branches, s.satellite.range, reserved);
      if (targets.length < branches)
        targets.push(
          ...closest(
            g.targets.filter((target) => reserved.has(target.id)),
            point,
            branches - targets.length,
            s.satellite.range,
          ),
        );
      targets.forEach((target) => reserved.add(target.id));
      fired += this.volley(
        { ...attack, satellite: index, range: s.satellite.range },
        point,
        targets,
        index,
      );
    }
    if (fired && attack.evolved.satellite) this.fireRing(attack);
    if (fired) this.activate('satellite');
    return fired > 0;
  }

  private secondary(attack: Attack, source: SkillId, multiplier: number): Attack {
    return {
      ...attack,
      source,
      damage: attack.power * multiplier,
      firstKill: undefined,
      depth: attack.depth + 1,
    };
  }

  private begin(source?: SkillId, multiplier = 1): Attack {
    const g = this.game,
      forms = g.forms;
    return {
      id: this.nextId++,
      ranks: { ...g.ranks },
      rarities: { ...g.rarities },
      evolved: { ...g.evolved },
      forms,
      power: g.damage,
      damage: g.damage * multiplier,
      range: g.range,
      source,
      depth: 0,
      budget: { burst: false },
    };
  }

  private effect(
    attack: Attack,
    kind: Effect['kind'],
    from: Point,
    to: Point,
    radius = 0,
    life = 0.14,
    anchored: Anchor = false,
    source = attack.source,
    width = 1.8,
    targetId?: number,
  ): void {
    this.game.addEffect({
      kind,
      from,
      to,
      radius,
      width,
      damage: ['bolt', 'strike', 'pierce', 'return'].includes(kind) ? attack.damage : 0,
      life,
      source,
      rarity: source ? attack.rarities[source] : 'common',
      rank: source ? attack.ranks[source] : 0,
      anchor: typeof anchored === 'number' ? anchored : anchored ? 'electron' : undefined,
      endAnchor: kind === 'return' ? (attack.satellite ?? 'electron') : undefined,
      targetId,
    });
  }

  private branch(attack: Attack, index: number): Attack {
    return index && attack.ranks.multi
      ? { ...attack, damage: attack.damage * attack.forms.multi.damage, firstKill: undefined }
      : attack;
  }

  private volley(attack: Attack, origin: Point, selected: Target[], anchored: Anchor): number {
    let fired = 0;
    for (const [i, target] of selected.entries()) {
      if (target.hp <= 0) continue;
      const branch = this.branch(attack, i);
      for (let hit = 1; hit < attack.forms.repeat.hits; hit++)
        this.pulses.push({
          at:
            this.game.tick +
            hit * this.game.rules.skills.repeat.delaySeconds * this.game.rules.tickRate,
          order: this.order++,
          attack: {
            ...branch,
            damage: branch.damage * attack.forms.repeat.damage,
            firstKill: undefined,
          },
          target,
          from: { ...origin },
          anchored,
        });
      this.emit(branch, origin, target, anchored);
      fired++;
    }
    if (fired > 1) this.activate('multi', attack.ranks.multi);
    if (fired > 1 && attack.evolved.multi && attack.depth === 0) this.linkTargets(attack, selected);
    return fired;
  }

  private linkTargets(attack: Attack, selected: Target[]): void {
    const damage = attack.damage * this.game.rules.evolution.multi.linkDamage,
      link = { ...attack, damage, depth: 2, firstKill: undefined };
    const alive = selected.filter((target) => target.hp > 0);
    for (const [i, target] of alive.entries()) {
      const next = alive[(i + 1) % alive.length];
      if (next === target || (alive.length === 2 && i === 1)) continue;
      this.effect(link, 'bolt', target, next, 0, 0.14, false, 'multi', 1.3);
      this.deal(link, next, damage);
    }
  }

  private fireRing(attack: Attack): void {
    const g = this.game,
      cfg = g.rules.evolution.satellite,
      points = this.satellitePoints;
    const damage = attack.damage * cfg.ringDamage,
      ring = { ...attack, damage, depth: 2, firstKill: undefined };
    const hit = new Set<number>();
    for (const [i, from] of points.entries()) {
      const to = points[(i + 1) % points.length];
      if (points.length < 2) break;
      this.effect(ring, 'pierce', from, to, 0, 0.14, false, 'satellite', cfg.width);
      for (const target of onSegment(g.targets, from, to, cfg.width)) {
        if (hit.has(target.id)) continue;
        hit.add(target.id);
        this.deal(ring, target, damage);
      }
    }
  }

  private updateTrails(): void {
    const g = this.game,
      cfg = g.rules.evolution.pierce;
    this.trails = this.trails.filter((trail) => g.time < trail.until - 1e-8);
    for (const trail of this.trails) {
      if (g.tick + 1e-8 < trail.next) continue;
      trail.next = g.tick + cfg.trailInterval * g.rules.tickRate;
      this.effect(
        trail.attack,
        'pierce',
        trail.from,
        trail.to,
        0,
        0.14,
        false,
        'pierce',
        trail.width,
      );
      for (const target of onSegment(g.targets, trail.from, trail.to, trail.width))
        this.deal(trail.attack, target, trail.attack.damage);
    }
  }

  // Overclock pact: a current stays on the orbit just behind the electron.
  private updateCurrent(): void {
    const g = this.game;
    if (!g.pacts.overclock || !g.combatEnabled) return;
    const cfg = g.rules.pacts.overclock,
      sweep = (cfg.trailAngle * Math.PI) / 180,
      start = g.angle - sweep;
    const attack = { ...this.begin(undefined, cfg.damage), depth: 1 };
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
      this.deal(attack, target, attack.damage);
    }
  }

  // Overheat pact: when the kill chain breaks, attacks stop to cool down.
  private updateOverheat(): void {
    const g = this.game;
    if (!g.pacts.overheat || !this.streak) return;
    const cfg = g.rules.pacts.overheat;
    if (g.time - this.lastKill <= cfg.windowSeconds) return;
    this.pausedUntil = g.time + this.streak * cfg.coolSeconds;
    this.streak = 0;
  }

  private emit(
    attack: Attack,
    origin: Point,
    target: Target,
    anchored: Anchor,
    repeated = false,
  ): void {
    const source = repeated
      ? 'repeat'
      : (attack.source ?? (attack.ranks.multi ? 'multi' : undefined));
    const strike = attack.source === 'strike' && !repeated;
    this.effect(
      attack,
      strike ? 'strike' : 'bolt',
      strike ? { x: target.x, y: target.y - 300 } : origin,
      target,
      strike ? attack.forms.strike.splash : 0,
      strike ? 0.3 : 0.14,
      strike ? false : anchored,
      source,
      1.8,
      target.id,
    );
    const point = { x: target.x, y: target.y };
    this.resolve(attack, target, origin, anchored);
    if (strike) this.splash(attack, point, target);
    if (attack.ranks.return && attack.depth === 0)
      this.pulses.push({
        at: this.game.tick + this.game.rules.skills.return.delaySeconds * this.game.rules.tickRate,
        order: this.order++,
        attack: {
          ...attack,
          source: 'return',
          damage: attack.damage * attack.forms.return.damage,
          depth: 1,
          firstKill: undefined,
        },
        reverse: point,
        anchored: false,
      });
  }

  // Thunderstrike impact: everything around the landing point pops with it.
  private splash(attack: Attack, at: Point, primary: Target): void {
    const g = this.game,
      radius = attack.forms.strike.splash;
    const damage = attack.damage * g.rules.skills.strike.splash.damage,
      child = { ...attack, damage, depth: Math.max(1, attack.depth), firstKill: undefined };
    for (const target of this.within(at, radius))
      if (target !== primary) this.deal(child, target, damage);
  }

  private resolve(
    attack: Attack,
    primary: Target,
    origin: Point,
    anchored: Anchor = false,
    end?: Point,
  ): void {
    if (primary.hp <= 0) return;
    const s = attack.forms,
      visited = new Set<number>([primary.id]),
      contact = { x: primary.x, y: primary.y };
    this.deal(attack, primary, attack.damage);
    if (s.pierce.length) {
      const direction =
        distance(contact, origin) > 0.001
          ? norm({ x: contact.x - origin.x, y: contact.y - origin.y })
          : norm({ x: this.game.position.x - origin.x, y: this.game.position.y - origin.y });
      const to = end ?? {
        x: origin.x + direction.x * s.pierce.length,
        y: origin.y + direction.y * s.pierce.length,
      };
      const damage = attack.damage * this.game.rules.skills.pierce.damage;
      this.effect(
        { ...attack, damage },
        'pierce',
        origin,
        to,
        0,
        0.14,
        anchored,
        'pierce',
        s.pierce.width,
      );
      this.activate('pierce', attack.ranks.pierce);
      for (const target of onSegment(this.game.targets, origin, to, s.pierce.width)) {
        if (visited.has(target.id)) continue;
        visited.add(target.id);
        this.deal(attack, target, damage);
      }
      const cfg = this.game.rules.evolution.pierce;
      if (attack.evolved.pierce && attack.depth === 0 && this.trails.length < cfg.maxTrails)
        this.trails.push({
          attack: {
            ...attack,
            damage: attack.damage * cfg.trailDamage,
            depth: 2,
            firstKill: undefined,
          },
          from: { ...origin },
          to: { ...to },
          width: s.pierce.width,
          until: this.game.time + cfg.trailSeconds,
          next: this.game.tick + cfg.trailInterval * this.game.rules.tickRate,
        });
    }
    this.chain(attack, contact, visited);
    this.discharge(attack);
  }

  private chain(attack: Attack, from: Point, visited: Set<number>): void {
    let previous = from;
    for (let hop = 0; hop < attack.forms.chain.hops; hop++) {
      const next = closest(this.game.targets, previous, 1, attack.forms.chain.range, visited)[0];
      if (!next) break;
      visited.add(next.id);
      const damage = attack.damage * this.game.rules.skills.chain.falloff ** (hop + 1);
      this.effect({ ...attack, damage }, 'bolt', previous, next, 0, 0.14, false, 'chain', 1.3);
      this.activate('chain', attack.ranks.chain);
      previous = { x: next.x, y: next.y };
      this.deal(attack, next, damage);
    }
    if (!attack.evolved.chain || !attack.forms.chain.hops) return;
    // Evolved: the bolt turns back through the same stretch at reduced power.
    const returned = new Set<number>();
    for (let hop = 0; hop < attack.forms.chain.hops; hop++) {
      const next = closest(this.game.targets, previous, 2, attack.forms.chain.range, returned).find(
        (target) => distance(target, previous) > 1e-6,
      );
      if (!next) break;
      returned.add(next.id);
      const damage =
        attack.damage *
        this.game.rules.evolution.chain.loopDamage *
        this.game.rules.skills.chain.falloff ** (hop + 1);
      this.effect({ ...attack, damage }, 'bolt', previous, next, 0, 0.14, false, 'chain', 1.3);
      previous = { x: next.x, y: next.y };
      this.deal(attack, next, damage);
    }
  }

  // Pact and critical modifiers apply to every hit, then the hit feeds Mark, Surge and Capacitor.
  private deal(attack: Attack, target: Target, base: number): void {
    if (target.hp <= 0) return;
    const g = this.game,
      pacts = g.rules.pacts;
    let damage = base;
    if (g.pacts.horizon) damage *= 1 + g.mass * pacts.horizon.damagePerMass;
    if (g.pacts.blast) damage *= pacts.blast.damageScale;
    const crit = g.critRoll() < critChance(g.boosts.crit, g.rules);
    if (crit) damage *= g.pacts.gamble ? pacts.gamble.critMultiplier : g.rules.crit.multiplier;
    else if (g.pacts.gamble) damage *= pacts.gamble.normalScale;
    const at = { x: target.x, y: target.y };
    g.damageTarget(target, damage, attack, crit);
    if (g.pacts.blast && attack.depth === 0) {
      const splash = attack.power * pacts.blast.damage,
        child = { ...attack, depth: 2, firstKill: undefined };
      for (const other of closest(g.targets, at, 8, pacts.blast.radius))
        if (other !== target) this.deal(child, other, splash);
    }
    if (attack.ranks.mark && attack.depth < 2 && target.hp > 0 && !target.marked) {
      target.marked = true;
      this.marked.add(target.id);
      if (this.marked.size >= attack.forms.mark.threshold) this.detonate(attack);
    }
    if (target.hp > 0 && attack.source !== 'surge' && g.time >= this.nextSurgeHit) {
      this.nextSurgeHit = g.time + g.rules.skills.surge.hitIntervalSeconds;
      this.chargeSurge(g.rules.skills.surge.hitCharge * Math.min(1, damage / attack.power));
    }
    if (attack.ranks.charge && attack.source !== 'charge' && attack.depth < 2) {
      this.storedCharge = Math.min(
        attack.forms.charge.threshold,
        this.storedCharge + Math.min(1, damage / attack.power),
      );
      const recipient = target.hp > 0 ? target : closest(g.targets, g.position, 1, attack.range)[0];
      if (recipient && this.storedCharge + 1e-8 >= attack.forms.charge.threshold) {
        this.storedCharge = 0;
        const charged = this.secondary(attack, 'charge', attack.forms.charge.damage);
        this.effect(charged, 'bolt', g.position, recipient, 0, 0.2, true, 'charge', 4);
        this.activate('charge', attack.ranks.charge);
        this.resolve(charged, recipient, g.position, true);
        if (attack.evolved.charge) this.ring(charged);
      } else
        this.effect(
          attack,
          'charge',
          g.position,
          g.position,
          10,
          0.3,
          true,
          'charge',
          this.storedCharge / attack.forms.charge.threshold,
        );
    }
  }

  // Evolved Capacitor: a full discharge also spreads as a ring around the electron.
  private ring(charged: Attack): void {
    const g = this.game,
      cfg = g.rules.evolution.charge,
      damage = charged.damage * cfg.damage,
      ring = { ...charged, damage, depth: 2, firstKill: undefined };
    this.effect(ring, 'field', g.position, g.position, cfg.ringRadius, 0.3, true, 'charge');
    for (const target of this.within(g.position, cfg.ringRadius)) this.deal(ring, target, damage);
  }

  // Static marks: once enough live particles carry a mark, they pop in a chain from the electron.
  private detonate(attack: Attack): void {
    const g = this.game,
      marked = g.targets.filter((t) => t.marked && t.hp > 0);
    this.marked = new Set(marked.map((t) => t.id));
    if (marked.length < attack.forms.mark.threshold) return;
    this.marked.clear();
    for (const target of marked) target.marked = false;
    const ordered: Target[] = [];
    let from: Point = g.position;
    const left = new Set(marked);
    while (left.size) {
      let next = marked[0],
        best = Infinity;
      for (const t of left) {
        const d = distance(t, from);
        if (d < best) [next, best] = [t, d];
      }
      left.delete(next);
      ordered.push(next);
      from = next;
    }
    const child = { ...this.secondary(attack, 'mark', attack.forms.mark.damage), depth: 2 };
    this.popInOrder(child, g.position, ordered, g.rules.skills.mark.popSeconds);
    this.activate('mark', attack.ranks.mark);
    if (!attack.evolved.mark) return;
    // Evolved: each detonation passes fresh marks to unmarked neighbours.
    const cfg = g.rules.evolution.mark,
      popping = new Set(ordered.map((t) => t.id));
    for (const source of ordered)
      for (const next of closest(g.targets, source, cfg.spread, cfg.radius, popping)) {
        if (next.marked) continue;
        next.marked = true;
        this.marked.add(next.id);
      }
  }

  private discharge(attack: Attack): void {
    const g = this.game;
    const limit =
      (attack.evolved.burst ? g.rules.evolution.burst.depth : 2) +
      (g.pacts.greed ? g.rules.pacts.greed.depth : 0);
    if (!attack.firstKill || !attack.ranks.burst || attack.budget.burst || attack.depth >= limit)
      return;
    attack.budget.burst = true;
    const from = attack.firstKill,
      targets = closest(
        g.targets,
        from,
        attack.forms.burst.count + attack.forms.multi.count - 1,
        attack.forms.burst.radius,
      );
    const child = this.secondary(attack, 'burst', attack.forms.burst.damage);
    // Evolved Death Arc: particles popped by a discharge discharge again.
    if (attack.evolved.burst || g.pacts.greed) child.budget = { burst: false };
    if (targets.length) this.activate('burst', attack.ranks.burst);
    this.volley(child, from, targets, false);
  }

  private reverse(attack: Attack, point: Point, outward = false): void {
    const electron =
      attack.satellite === undefined
        ? this.game.position
        : (this.satellitePoints[attack.satellite] ?? this.game.position);
    const [from, to] = outward ? [electron, point] : [point, electron];
    const targets = onSegment(this.game.targets, from, to, attack.forms.return.width);
    this.effect(attack, 'return', from, to, 0, 0.2, false, 'return');
    this.activate('return', attack.ranks.return);
    // One shared visit set keeps the swept path and its chain branches from doubling hits.
    const visited = new Set(targets.map((t) => t.id));
    for (const target of targets) this.deal(attack, target, attack.damage);
    this.chain(attack, targets.at(-1) ?? from, visited);
    this.discharge(attack);
    // Evolved Return: the bolt bounces back out once more.
    if (attack.evolved.return && !attack.spent)
      this.pulses.push({
        at: this.game.tick + this.game.rules.skills.return.delaySeconds * this.game.rules.tickRate,
        order: this.order++,
        attack: {
          ...attack,
          spent: true,
          damage: attack.damage * this.game.rules.evolution.return.echoDamage,
          firstKill: undefined,
          budget: { burst: false },
        },
        reverse: point,
        outward: true,
        anchored: false,
      });
  }

  private updateSurge(): void {
    const g = this.game;
    if (g.time >= this.surgeUntil || !this.surgeAttack || g.tick < this.nextSurge) return;
    const attack = {
      ...this.surgeAttack,
      id: this.nextId++,
      budget: { burst: false },
      firstKill: undefined,
    };
    this.volley(
      attack,
      g.position,
      closest(g.targets, g.position, attack.forms.multi.count, attack.range),
      true,
    );
    this.nextSurge =
      g.tick + Math.max(0.05, g.rules.skills.surge.tickSeconds / g.rate) * g.rules.tickRate;
  }

  private activate(id: SkillId, rank = this.game.ranks[id]): void {
    if (!rank) return;
    this.activations[id] ??= this.game.time;
    this.firedAt[id] = this.game.time;
    if (['multi', 'repeat', 'chain', 'pierce', 'return'].includes(id))
      this.nextLinked[id] = this.game.tick + this.game.attackInterval * this.game.rules.tickRate;
    this.game.log('skill-effect', { id, rank });
  }
}
