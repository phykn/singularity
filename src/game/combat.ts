import { linkedSkills, timedSkills } from './skills.ts';
import type { LinkedSkill, PopStyle, SkillValues, TimedSkill } from './skills.ts';
import { CENTER, distance, norm, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { closest, onSegment } from './targeting.ts';
import { critChance } from './rules.ts';
import type { Ranks, Rarities, SkillId, UpgradeId } from './rules.ts';
import type { Effect, SkillStatus, Target } from './types.ts';
import type { Game } from './Game.ts';

type Anchor = boolean | number;

export type Attack = {
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
  // Fork split this volley; its basic hits pop all at once.
  fork?: boolean;
};
// How the kills of one hit pop; lines sweep outward from where they start.
export type Pop = { style: PopStyle; from?: Point };
// Work that lands a few ticks later: repeat hits, staggered pops, returning bolts, splits.
type Work = { attack: Attack } & (
  | { kind: 'hit'; target?: Target; from: Point; anchored: Anchor }
  // A single delayed hit that lets a group of particles pop one after another.
  | { kind: 'pop'; target: Target; from?: Point }
  // Evolved Return: an outward bolt goes back out from the electron to `point`.
  | { kind: 'return'; point: Point; outward?: boolean }
  | { kind: 'split'; point: Point }
  | { kind: 'remnant'; point: Point }
  | { kind: 'overcharge'; scale: number }
);
type Scheduled = Work & { at: number; order: number };
type HitWork = Extract<Scheduled, { kind: 'hit' }>;
type EffectStyle = {
  radius?: number;
  life?: number;
  anchored?: Anchor;
  source?: SkillId;
  width?: number;
  targetId?: number;
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
  private order = 0;
  private nextSkill: Record<TimedSkill, number> = {
    strike: Infinity,
    satellite: Infinity,
    spark: Infinity,
    field: Infinity,
  };
  private scheduled: Scheduled[] = [];
  private trails: Trail[] = [];
  private surgeCharge = 0;
  private storedCharge = 0;
  // Quarters already sounded while each charge skill builds toward its release.
  private building: Partial<Record<'charge' | 'surge' | 'overcharge', number>> = {};
  private lastSurgeCharge = -Infinity;
  private nextSurgeHit = 0;
  private surgeUntil = 0;
  private surgeExtended = 0;
  private nextSurge = 0;
  private surgeAttack?: Attack;
  private marked = new Set<number>();
  private overchargeKills = 0;
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
    const due = this.scheduled
      .filter((w) => w.at <= g.tick + 1e-8)
      .sort((a, b) => a.at - b.at || a.order - b.order);
    this.scheduled = this.scheduled.filter((w) => w.at > g.tick + 1e-8);
    for (const work of due) {
      if (work.kind === 'return') this.reverse(work.attack, work.point, work.outward);
      else if (work.kind === 'pop') this.pop(work.attack, work.target, work.from);
      else if (work.kind === 'split') this.split(work.attack, work.point);
      else if (work.kind === 'remnant') this.remnant(work.attack, work.point);
      else if (work.kind === 'overcharge') this.overcharge(work.scale, true);
      else this.repeatHit(work);
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
      if (this.fireSkill(id)) this.nextSkill[id] = g.tick + this.periodTicks(id);
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
    if (id === 'charge' || id === 'mark' || id === 'overcharge') {
      const [filled, needed] =
        id === 'charge'
          ? [this.storedCharge, g.forms.charge.threshold || 1]
          : id === 'mark'
            ? [this.marked.size, g.forms.mark.threshold]
            : [this.overchargeKills, g.forms.overcharge.kills];
      return { mode: 'charging', progress: Math.min(1, filled / needed), active: false, fired };
    }
    if (id === 'burst' || id === 'tempo' || id === 'fission')
      return { mode: 'conditional', progress: 0, active: false, fired };
    const timed = timedSkills.includes(id as TimedSkill),
      skill = id as TimedSkill;
    const interval = timed ? this.periodTicks(skill) : g.attackInterval * g.rules.tickRate;
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

  private periodTicks(id: TimedSkill): number {
    const g = this.game;
    return (g.rules.skills[id].periodSeconds / g.rate) * g.rules.tickRate;
  }

  rescaleCooldowns(oldRate: number): void {
    const { tick, rate } = this.game,
      ratio = oldRate / rate;
    this.nextAttack = tick + Math.max(0, this.nextAttack - tick) * ratio;
    this.nextSurge = tick + Math.max(0, this.nextSurge - tick) * ratio;
    this.nextStorm = tick + Math.max(0, this.nextStorm - tick) * ratio;
    for (const id of Object.keys(this.nextLinked) as SkillId[])
      this.nextLinked[id] = tick + Math.max(0, this.nextLinked[id]! - tick) * ratio;
    for (const id of timedSkills)
      if (Number.isFinite(this.nextSkill[id]))
        this.nextSkill[id] = tick + Math.max(0, this.nextSkill[id] - tick) * ratio;
  }

  clear(): void {
    this.scheduled = [];
    this.trails = [];
    this.surgeCharge = 0;
    this.storedCharge = 0;
    this.building = {};
    this.surgeUntil = 0;
    this.surgeAttack = undefined;
    this.marked.clear();
    this.overchargeKills = 0;
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
    // A kill either charges the surge or, once it runs, extends an evolved one; never both.
    const surging = g.time < this.surgeUntil;
    this.chargeSurge(1);
    if (g.evolved.surge && surging) {
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
      this.overchargeKills++;
      this.build('overcharge', this.overchargeKills / g.forms.overcharge.kills);
      if (this.overchargeKills >= g.forms.overcharge.kills) {
        this.overchargeKills = 0;
        this.build('overcharge', 0);
        this.overcharge(1);
      }
    }
    if (g.ranks.fission) {
      const generation = attack?.source === 'fission' ? (attack.generation ?? 0) : 0;
      const depth = g.forms.fission.depth + (g.pacts.greed ? g.rules.pacts.greed.depth : 0);
      if (generation < depth)
        this.schedule(g.rules.skills.fission.delaySeconds, {
          kind: 'split',
          attack: { ...this.begin('fission', g.forms.fission.damage), generation, depth: 2 },
          point,
        });
    }
    if (attack?.source === 'field' && !attack.spent && g.evolved.field)
      this.schedule(g.rules.evolution.field.delaySeconds, {
        kind: 'remnant',
        attack: { ...attack, spent: true, depth: 2 },
        point,
      });
  }

  private schedule(seconds: number, work: Work): void {
    this.scheduled.push({
      ...work,
      at: this.game.tick + seconds * this.game.rules.tickRate,
      order: this.order++,
    });
  }

  // Charging skills sound each quarter they fill, so a release has a build-up before it.
  private build(id: 'charge' | 'surge' | 'overcharge', progress: number): void {
    const step = Math.floor(progress * 4 + 1e-8),
      last = this.building[id] ?? 0;
    if (step > last && step < 4) this.game.log('build', { id, step });
    this.building[id] = step;
  }

  private chargeSurge(amount: number): void {
    const g = this.game;
    if (!g.ranks.surge || g.time < this.surgeUntil) return;
    if (g.time - this.lastSurgeCharge > g.rules.skills.surge.windowSeconds) this.surgeCharge = 0;
    this.lastSurgeCharge = g.time;
    this.surgeCharge += amount;
    const surge = g.forms.surge;
    this.build('surge', this.surgeCharge / surge.kills);
    if (this.surgeCharge < surge.kills) return;
    this.surgeCharge = 0;
    this.build('surge', 0);
    this.surgeUntil = g.time + surge.duration;
    this.surgeExtended = 0;
    this.nextSurge = g.tick + 1;
    this.surgeAttack = this.begin('surge', surge.damage);
    this.activate('surge');
    this.effect(this.surgeAttack, 'surge', g.position, g.position, {
      radius: 12,
      life: this.surgeUntil - g.time,
      anchored: true,
    });
  }

  fireBasic(origin: Point = this.game.position, multiplier = 1, count?: number): boolean {
    if (!this.reaches(origin, this.game.range)) return false;
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
    if (!this.reaches(g.position, g.range)) return false;
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
    const targets = this.alongOrbit((t) => t.radius <= g.radius + band).slice(0, count);
    if (!targets.length) return false;
    const attack = { ...this.begin(source, damage), depth: 2 };
    this.popInOrder(attack, g.position, targets, g.rules.skills.tempo.popSeconds);
    return true;
  }

  private popInOrder(attack: Attack, start: Point | undefined, targets: Target[], gap: number) {
    let from = start;
    for (const [i, target] of targets.entries()) {
      this.schedule(i * gap, { kind: 'pop', attack, target, from: from && { ...from } });
      if (from) from = { x: target.x, y: target.y };
    }
  }

  private pop(attack: Attack, target: Target, from?: Point): void {
    const g = this.game;
    if (target.hp <= 0 || !g.targets.includes(target)) return;
    if (from) this.effect(attack, 'bolt', from, target, { width: 1.3, targetId: target.id });
    this.deal(attack, target, attack.damage);
    // Evolved Charged Bolt: each spark bounces once to a nearby particle.
    if (attack.source === 'spark' && attack.evolved.spark && !attack.spent) {
      const cfg = g.rules.evolution.spark;
      const next = closest(g.targets, target, 1, cfg.bounceRange, new Set([target.id]))[0];
      if (next)
        this.schedule(g.rules.skills.spark.popSeconds * 2, {
          kind: 'pop',
          attack: { ...attack, spent: true, damage: attack.damage * cfg.bounceDamage },
          target: next,
          from: { x: target.x, y: target.y },
        });
    }
  }

  private repeatHit(work: HitWork): void {
    const g = this.game;
    const from =
      typeof work.anchored === 'number'
        ? (this.satellitePoints[work.anchored] ?? work.from)
        : work.anchored
          ? g.position
          : work.from;
    const target =
      work.target && work.target.hp > 0 && g.targets.includes(work.target)
        ? work.target
        : closest(g.targets, from, 1, work.attack.range)[0];
    if (!target) return;
    this.emit(work.attack, from, target, work.anchored, true);
    this.activate('repeat');
    // Evolved Repeat: a kill adds one more hit, so the stream continues while kills continue.
    const extra = work.attack.extra ?? 0;
    if (target.hp <= 0 && work.attack.evolved.repeat && extra < g.rules.evolution.repeat.maxExtra)
      this.schedule(g.rules.skills.repeat.delaySeconds, {
        ...work,
        attack: { ...work.attack, extra: extra + 1 },
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

  private reaches(origin: Point, range: number): boolean {
    return this.game.targets.some((t) => t.hp > 0 && distance(t, origin) <= range);
  }

  // Live particles matching `near`, in the order the electron reaches them going forward.
  private alongOrbit(near: (target: Target) => boolean): Target[] {
    const g = this.game;
    return g.targets
      .filter((t) => t.hp > 0 && near(t))
      .sort((a, b) => ahead(a.angle, g.angle) - ahead(b.angle, g.angle) || a.id - b.id);
  }

  // Hits each particle on the segment once across a run of joined segments.
  private hitSegment(attack: Attack, from: Point, to: Point, width: number, hit: Set<number>) {
    for (const target of onSegment(this.game.targets, from, to, width)) {
      if (hit.has(target.id)) continue;
      hit.add(target.id);
      this.deal(attack, target, attack.damage);
    }
  }

  // Thunderstrike at rank 5: the last bolt joins every impact point.
  private thunder(attack: Attack, targets: Target[]): void {
    const g = this.game;
    g.log('thunder', { count: targets.length });
    if (attack.ranks.strike < g.rules.maxRank || targets.length < 2) return;
    const cfg = g.rules.skills.strike.thunder,
      link = this.derive(attack, attack.damage * cfg.damage, 2);
    const points = targets.map((t) => ({ x: t.x, y: t.y }));
    const hit = new Set<number>();
    for (let i = 1; i < points.length; i++) {
      this.effect(link, 'bolt', points[i - 1], points[i], {
        life: 0.22,
        source: 'strike',
        width: 2.4,
      });
      this.hitSegment(link, points[i - 1], points[i], cfg.width, hit);
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
      this.schedule(i * g.rules.skills.spark.popSeconds, {
        kind: 'pop',
        attack: spark,
        target,
        from: { ...origin },
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
    this.effect(field, 'field', origin, origin, { radius: s.radius, life: 0.35, anchored: true });
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
    this.effect(attack, 'field', at, at, { radius: cfg.radius, life: 0.25 });
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
      this.effect(child, 'bolt', from, target, {
        source: 'fission',
        width: 1.3,
        targetId: target.id,
      });
      this.deal(child, target, child.damage);
    }
    this.activate('fission');
  }

  // Overcharge: kills heat the electron until the whole orbit discharges at once.
  private overcharge(scale: number, echo = false): void {
    const g = this.game,
      s = g.forms.overcharge;
    const targets = this.alongOrbit((t) => Math.abs(t.radius - g.radius) <= s.band);
    const attack = { ...this.begin('overcharge', s.damage * scale), depth: 2 };
    this.effect(attack, 'field', CENTER, CENTER, { radius: g.radius, life: 0.4 });
    this.popInOrder(attack, undefined, targets, g.rules.skills.overcharge.popSeconds);
    this.activate('overcharge');
    if (!echo && g.evolved.overcharge) {
      const cfg = g.rules.evolution.overcharge;
      this.schedule(cfg.delaySeconds, { kind: 'overcharge', attack, scale: cfg.damage });
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
    if (fired && attack.evolved.satellite) this.satelliteRing(attack);
    if (fired) this.activate('satellite');
    return fired > 0;
  }

  // A follow-up hit carries the attack's modifiers but starts its own first kill.
  private derive(attack: Attack, damage: number, depth = attack.depth): Attack {
    return { ...attack, damage, depth, firstKill: undefined };
  }

  private secondary(attack: Attack, source: SkillId, multiplier: number): Attack {
    return { ...this.derive(attack, attack.power * multiplier, attack.depth + 1), source };
  }

  private begin(source?: SkillId, multiplier = 1): Attack {
    const g = this.game,
      forms = g.forms;
    return {
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
    {
      radius = 0,
      life = 0.14,
      anchored = false,
      source = attack.source,
      width = 1.8,
      targetId,
    }: EffectStyle = {},
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
      ? this.derive(attack, attack.damage * attack.forms.multi.damage)
      : attack;
  }

  private volley(attack: Attack, origin: Point, selected: Target[], anchored: Anchor): number {
    let fired = 0;
    if (attack.ranks.multi && selected.length > 1) attack.fork = true;
    for (const [i, target] of selected.entries()) {
      if (target.hp <= 0) continue;
      const branch = this.branch(attack, i);
      for (let hit = 1; hit < attack.forms.repeat.hits; hit++)
        this.schedule(hit * this.game.rules.skills.repeat.delaySeconds, {
          kind: 'hit',
          attack: this.derive(branch, branch.damage * attack.forms.repeat.damage),
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
      link = this.derive(attack, damage, 2);
    const alive = selected.filter((target) => target.hp > 0);
    for (const [i, target] of alive.entries()) {
      const next = alive[(i + 1) % alive.length];
      if (next === target || (alive.length === 2 && i === 1)) continue;
      this.effect(link, 'bolt', target, next, { source: 'multi', width: 1.3 });
      this.deal(link, next, damage);
    }
  }

  // Evolved Satellite: the satellites are joined into a ring of current.
  private satelliteRing(attack: Attack): void {
    const cfg = this.game.rules.evolution.satellite,
      points = this.satellitePoints;
    const ring = this.derive(attack, attack.damage * cfg.ringDamage, 2);
    const hit = new Set<number>();
    for (const [i, from] of points.entries()) {
      const to = points[(i + 1) % points.length];
      if (points.length < 2) break;
      this.effect(ring, 'pierce', from, to, { source: 'satellite', width: cfg.width });
      this.hitSegment(ring, from, to, cfg.width, hit);
    }
  }

  private updateTrails(): void {
    const g = this.game,
      cfg = g.rules.evolution.pierce;
    this.trails = this.trails.filter((trail) => g.time < trail.until - 1e-8);
    for (const trail of this.trails) {
      if (g.tick + 1e-8 < trail.next) continue;
      trail.next = g.tick + cfg.trailInterval * g.rules.tickRate;
      this.effect(trail.attack, 'pierce', trail.from, trail.to, {
        source: 'pierce',
        width: trail.width,
      });
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
      strike
        ? { radius: attack.forms.strike.splash, life: 0.3, source, targetId: target.id }
        : { anchored, source, targetId: target.id },
    );
    const point = { x: target.x, y: target.y };
    this.resolve(attack, target, origin, anchored);
    if (strike) this.splash(attack, point, target);
    if (attack.ranks.return && attack.depth === 0)
      this.schedule(this.game.rules.skills.return.delaySeconds, {
        kind: 'return',
        attack: {
          ...this.derive(attack, attack.damage * attack.forms.return.damage, 1),
          source: 'return',
        },
        point,
      });
  }

  // Thunderstrike impact: everything around the landing point pops with it.
  private splash(attack: Attack, at: Point, primary: Target): void {
    const g = this.game,
      radius = attack.forms.strike.splash;
    const damage = attack.damage * g.rules.skills.strike.splash.damage,
      child = this.derive(attack, damage, Math.max(1, attack.depth));
    for (const target of this.within(at, radius))
      if (target !== primary) this.deal(child, target, damage);
  }

  private resolve(attack: Attack, primary: Target, origin: Point, anchored: Anchor = false): void {
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
      const to = {
        x: origin.x + direction.x * s.pierce.length,
        y: origin.y + direction.y * s.pierce.length,
      };
      const damage = attack.damage * this.game.rules.skills.pierce.damage;
      this.effect({ ...attack, damage }, 'pierce', origin, to, {
        anchored,
        source: 'pierce',
        width: s.pierce.width,
      });
      this.activate('pierce', attack.ranks.pierce);
      for (const target of onSegment(this.game.targets, origin, to, s.pierce.width)) {
        if (visited.has(target.id)) continue;
        visited.add(target.id);
        this.deal(attack, target, damage, { style: 'sweep', from: origin });
      }
      const cfg = this.game.rules.evolution.pierce;
      if (attack.evolved.pierce && attack.depth === 0 && this.trails.length < cfg.maxTrails)
        this.trails.push({
          attack: this.derive(attack, attack.damage * cfg.trailDamage, 2),
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
      this.effect({ ...attack, damage }, 'bolt', previous, next, { source: 'chain', width: 1.3 });
      this.activate('chain', attack.ranks.chain);
      previous = { x: next.x, y: next.y };
      this.deal(attack, next, damage, { style: 'tap' });
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
      this.effect({ ...attack, damage }, 'bolt', previous, next, { source: 'chain', width: 1.3 });
      previous = { x: next.x, y: next.y };
      this.deal(attack, next, damage, { style: 'tap' });
    }
  }

  // Pact and critical modifiers apply to every hit, then the hit feeds Mark, Surge and Capacitor.
  private deal(attack: Attack, target: Target, base: number, pop?: Pop): void {
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
    g.damageTarget(target, damage, attack, crit, pop);
    if (g.pacts.blast && attack.depth === 0) {
      const splash = attack.power * pacts.blast.damage,
        child = this.derive(attack, attack.damage, 2);
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
      this.build('charge', this.storedCharge / attack.forms.charge.threshold);
      const recipient = target.hp > 0 ? target : closest(g.targets, g.position, 1, attack.range)[0];
      if (recipient && this.storedCharge + 1e-8 >= attack.forms.charge.threshold) {
        this.storedCharge = 0;
        this.build('charge', 0);
        const charged = this.secondary(attack, 'charge', attack.forms.charge.damage);
        this.effect(charged, 'bolt', g.position, recipient, {
          life: 0.2,
          anchored: true,
          source: 'charge',
          width: 4,
        });
        this.activate('charge', attack.ranks.charge);
        this.resolve(charged, recipient, g.position, true);
        if (attack.evolved.charge) this.chargeRing(charged);
      } else
        // The charge glow's width carries how full the capacitor is.
        this.effect(attack, 'charge', g.position, g.position, {
          radius: 10,
          life: 0.3,
          anchored: true,
          source: 'charge',
          width: this.storedCharge / attack.forms.charge.threshold,
        });
    }
  }

  // Evolved Capacitor: a full discharge also spreads as a ring around the electron.
  private chargeRing(charged: Attack): void {
    const g = this.game,
      cfg = g.rules.evolution.charge,
      damage = charged.damage * cfg.damage,
      ring = this.derive(charged, damage, 2);
    this.effect(ring, 'field', g.position, g.position, {
      radius: cfg.ringRadius,
      life: 0.3,
      anchored: true,
      source: 'charge',
    });
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
    this.effect(attack, 'return', from, to, { life: 0.2, source: 'return' });
    this.activate('return', attack.ranks.return);
    // One shared visit set keeps the swept path and its chain branches from doubling hits.
    const visited = new Set(targets.map((t) => t.id));
    for (const target of targets)
      this.deal(attack, target, attack.damage, { style: 'sweep', from });
    this.chain(attack, targets.at(-1) ?? from, visited);
    this.discharge(attack);
    // Evolved Return: the bolt bounces back out once more.
    if (attack.evolved.return && !attack.spent)
      this.schedule(this.game.rules.skills.return.delaySeconds, {
        kind: 'return',
        attack: {
          ...this.derive(attack, attack.damage * this.game.rules.evolution.return.echoDamage),
          spent: true,
          budget: { burst: false },
        },
        point,
        outward: true,
      });
  }

  private updateSurge(): void {
    const g = this.game;
    if (g.time >= this.surgeUntil || !this.surgeAttack || g.tick < this.nextSurge) return;
    const attack = { ...this.surgeAttack, budget: { burst: false }, firstKill: undefined };
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
    if (linkedSkills.includes(id as LinkedSkill))
      this.nextLinked[id] = this.game.tick + this.game.attackInterval * this.game.rules.tickRate;
    this.game.log('skill-effect', { id, rank });
  }
}
