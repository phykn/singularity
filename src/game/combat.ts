import { CENTER, TAU, ahead, distance, norm, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { critChance } from './rules.ts';
import type { PopStyle, SkillId } from './rules.ts';
import { linkedSkills, timedSkills } from './skills.ts';
import type { TimedSkill } from './skills.ts';
import { closest, onSegment } from './targeting.ts';
import type { Game } from './Game.ts';
import type { Effect, Target } from './types.ts';

// How the kills of one hit pop; lines sweep outward from where they start.
export type Pop = { style: PopStyle; from?: Point };
// Where a bolt starts each frame: the electron (true), a satellite (its index), or a fixed point.
type Anchor = boolean | number;
export type Attack = {
  // The basic hit damage when the attack began; skill multipliers apply to it.
  power: number;
  damage: number;
  range: number;
  source?: SkillId;
  // 0 a fired attack, 1 derived from one, 2 terminal: no further cascades.
  depth: number;
  budget: { burst: boolean };
  firstKill?: Point;
  // Several primaries in one volley; their basic kills pop all at once.
  fork?: boolean;
  // The satellite that fired, so a returning bolt goes back to it.
  satellite?: number;
  generation?: number;
  // Repeat hits already added by kills (evolved Repeat).
  extra?: number;
  // A spark that already bounced, an echo that already went out, a field remnant.
  spent?: boolean;
};
// Work that lands a few ticks later; a hit without a target takes the nearest.
type Work = { at: number; order: number; attack: Attack } & (
  | { kind: 'hit'; target?: Target; from: Point; anchored: Anchor }
  | { kind: 'pop'; target: Target; from?: Point }
  | { kind: 'return'; point: Point; outward?: boolean }
  | { kind: 'split'; point: Point }
  | { kind: 'remnant'; point: Point }
  | { kind: 'overcharge'; scale: number }
);
type Unscheduled<T> = T extends unknown ? Omit<T, 'at' | 'order'> : never;
type Later = Unscheduled<Work>;
type Style = {
  radius?: number;
  life?: number;
  anchored?: Anchor;
  source?: SkillId;
  width?: number;
};
export type SkillStatus = {
  mode: 'linked' | 'timed' | 'charging' | 'conditional';
  progress: number;
  active: boolean;
  fired: boolean;
};
type Building = 'charge' | 'surge' | 'overcharge';
// An evolved Pierce line that keeps hitting for a while.
type Trail = { attack: Attack; from: Point; to: Point; width: number; until: number; next: number };

export class Combat {
  private readonly game: Game;
  private nextAttack: number;
  private nextSkill: Record<TimedSkill, number> = {
    strike: Infinity,
    satellite: Infinity,
    spark: Infinity,
    field: Infinity,
  };
  private nextLinked: Partial<Record<SkillId, number>> = {};
  private scheduled: Work[] = [];
  private order = 0;
  private fired: Partial<Record<SkillId, number>> = {};
  private building: Partial<Record<Building, number>> = {};
  private stored = 0;
  private marked = new Set<number>();
  private overchargeKills = 0;
  private trails: Trail[] = [];
  private nextStorm = 0;
  private stormTurn = 0;
  // Pacts
  private streak = 0;
  private lastKill = -Infinity;
  private pausedUntil = 0;
  private banked = 0;
  private nextRelease = 0;
  private drawnTrail = -Infinity;
  private surge = {
    charge: 0,
    last: -Infinity,
    until: 0,
    extended: 0,
    next: 0,
    nextHit: 0,
    attack: undefined as Attack | undefined,
  };

  constructor(game: Game) {
    this.game = game;
    // Not `attackInterval`: the rate reads this combat's heat.
    this.nextAttack = game.rules.combat.attackSeconds * game.rules.time.tickRate;
  }

  get surging(): boolean {
    return this.game.time < this.surge.until;
  }

  // Overheat: chained kills raise the attack rate until the chain breaks.
  get heatScale(): number {
    return this.game.pacts.overheat ? 1 + this.streak * this.game.rules.pacts.overheat.rateStep : 1;
  }

  get satellites(): Point[] {
    const g = this.game,
      s = g.rules.skills.satellite,
      count = g.forms.satellite.count,
      at = g.position;
    return Array.from({ length: count }, (_, i) => {
      const angle = g.time * s.angularSpeed + (i * TAU) / count;
      return {
        x: at.x + Math.cos(angle) * s.orbitRadius,
        y: at.y + Math.sin(angle) * s.orbitRadius,
      };
    });
  }

  update(): void {
    const g = this.game,
      due = this.scheduled.filter((w) => w.at <= g.tick + 1e-8);
    if (due.length) {
      this.scheduled = this.scheduled.filter((w) => w.at > g.tick + 1e-8);
      for (const work of due.sort((a, b) => a.at - b.at || a.order - b.order)) {
        if (work.kind === 'hit') this.repeatHit(work);
        else if (work.kind === 'pop') this.pop(work.attack, work.target, work.from);
        else if (work.kind === 'return') this.reverse(work.attack, work.point, work.outward);
        else if (work.kind === 'split') this.split(work.attack, work.point);
        else if (work.kind === 'remnant') this.remnant(work.attack, work.point);
        else this.overcharge(work.scale, true);
      }
    }
    this.updateOverheat();
    const held = g.time < this.pausedUntil;
    if (
      g.combatEnabled &&
      !held &&
      g.tick + 1e-8 >= this.nextAttack &&
      (g.pacts.quiet ? this.bank() : this.fireBasic())
    ) {
      // Regular fire keeps its fractional cadence; an attack that waited idle starts afresh.
      const at = g.tick - this.nextAttack < 1 + 1e-8 ? this.nextAttack : g.tick;
      this.nextAttack = at + g.attackInterval * g.rules.time.tickRate;
    }
    if (g.pacts.quiet && g.combatEnabled) this.release();
    for (const id of timedSkills)
      if (!held && this.nextSkill[id] <= g.tick + 1e-8 && this.fireSkill(id))
        this.nextSkill[id] = g.tick + this.period(id);
    this.updateStorm();
    this.updateTrails();
    this.updateCurrent();
    this.updateSurge();
  }

  // What the loadout shows for a skill: its cooldown, its charge, or nothing to wait for.
  status(id: SkillId): SkillStatus {
    const g = this.game,
      f = g.forms,
      fired = g.phase === 'running' && g.time - (this.fired[id] ?? -1) < 0.16;
    const charging = (filled: number, needed: number, active = false): SkillStatus => ({
      mode: 'charging',
      progress: Math.min(1, filled / needed),
      active,
      fired,
    });
    if (id === 'surge') {
      const s = this.surge,
        cold = g.time - s.last > g.rules.skills.surge.windowSeconds;
      return charging(
        this.surging ? 1 : cold ? 0 : s.charge,
        this.surging ? 1 : f.surge.kills,
        this.surging,
      );
    }
    if (id === 'charge') return charging(this.stored, f.charge.threshold || 1);
    if (id === 'mark') return charging(this.marked.size, f.mark.threshold);
    if (id === 'overcharge') return charging(this.overchargeKills, f.overcharge.kills);
    if (id === 'burst' || id === 'tempo' || id === 'fission')
      return { mode: 'conditional', progress: 0, active: false, fired };
    const timed = (timedSkills as readonly SkillId[]).includes(id),
      interval = timed ? this.period(id as TimedSkill) : g.attackInterval * g.rules.time.tickRate,
      next = timed ? this.nextSkill[id as TimedSkill] : (this.nextLinked[id] ?? g.tick);
    const progress = Math.max(0, Math.min(1, 1 - (next - g.tick) / interval));
    return { mode: timed ? 'timed' : 'linked', progress, active: false, fired };
  }

  // A timed skill fires on the tick after it is first taken.
  learn(id: SkillId): void {
    if ((timedSkills as readonly SkillId[]).includes(id) && this.game.ranks[id] === 1)
      this.nextSkill[id as TimedSkill] = this.game.tick + 1;
  }

  // A rate change stretches the waits already under way.
  rescale(oldRate: number): void {
    const { tick, rate } = this.game,
      stretch = (at: number) => tick + Math.max(0, at - tick) * (oldRate / rate);
    this.nextAttack = stretch(this.nextAttack);
    this.surge.next = stretch(this.surge.next);
    this.nextStorm = stretch(this.nextStorm);
    for (const id of Object.keys(this.nextLinked) as SkillId[])
      this.nextLinked[id] = stretch(this.nextLinked[id]!);
    for (const id of timedSkills)
      if (Number.isFinite(this.nextSkill[id])) this.nextSkill[id] = stretch(this.nextSkill[id]);
  }

  private period(id: TimedSkill): number {
    const g = this.game;
    return (g.rules.skills[id].periodSeconds / g.rate) * g.rules.time.tickRate;
  }

  fireBasic(origin: Point = this.game.position, multiplier = 1, count?: number): boolean {
    const attack = this.begin(undefined, multiplier),
      limit = count ?? this.game.forms.multi.count,
      selected = closest(this.game.targets, origin, limit, attack.range);
    // Basic fire always answers the boss, so builds without single-target skills can fight it.
    const boss = this.game.boss;
    if (boss && !selected.includes(boss) && distance(boss, origin) <= attack.range) {
      selected.unshift(boss);
      selected.length = Math.min(selected.length, limit);
    }
    this.volley(attack, origin, selected, true);
    return selected.length > 0;
  }

  // Quiet pact: basic shots are held and released together on a fixed beat.
  private bank(): boolean {
    const g = this.game;
    if (!this.within(g.position, g.range).length) return false;
    this.banked++;
    return true;
  }

  private release(): void {
    const g = this.game,
      cfg = g.rules.pacts.quiet;
    if (g.time + 1e-8 < this.nextRelease) return;
    this.nextRelease = g.time + cfg.periodSeconds;
    if (!this.banked) return;
    const shots = this.banked * g.forms.multi.count,
      reach = closest(g.targets, g.position, shots, g.range).length;
    this.banked = 0;
    if (!reach) return;
    this.fireBasic(g.position, (cfg.damage * shots) / reach, reach);
    g.log('release', { shots });
  }

  fireSkill(id: TimedSkill, origin: Point = this.game.position): boolean {
    const g = this.game,
      f = g.forms;
    if (!g.ranks[id] || !g.targets.length) return false;
    const attack = this.begin(id, f[id].damage);
    if (id === 'satellite') return this.fireSatellite(attack);
    if (id === 'spark') return this.fireSpark(attack, origin);
    if (id === 'field') return this.fireField(attack, origin);
    const targets = this.strongest(origin, f.strike.range, f.strike.count + f.multi.count - 1);
    if (!targets.length) return false;
    this.volley(attack, origin, targets, true);
    this.activate('strike');
    this.thunder(attack, targets);
    return true;
  }

  private schedule(seconds: number, work: Later): void {
    const g = this.game;
    this.scheduled.push({
      ...work,
      at: g.tick + seconds * g.rules.time.tickRate,
      order: this.order++,
    } as Work);
  }

  private begin(source?: SkillId, multiplier = 1): Attack {
    const g = this.game;
    return {
      power: g.damage,
      damage: g.damage * multiplier,
      range: g.range,
      source,
      depth: 0,
      budget: { burst: false },
    };
  }
  // A follow-up hit carries the attack's modifiers but starts its own first kill.
  private derive(attack: Attack, damage: number, depth = attack.depth): Attack {
    return { ...attack, damage, depth, firstKill: undefined };
  }
  private secondary(attack: Attack, source: SkillId, multiplier: number): Attack {
    return { ...this.derive(attack, attack.power * multiplier, attack.depth + 1), source };
  }

  private strongest(origin: Point, range: number, count: number): Target[] {
    return this.within(origin, range)
      .sort((a, b) => b.maxHp - a.maxHp || a.hp - b.hp || a.radius - b.radius || a.id - b.id)
      .slice(0, count);
  }
  private within(origin: Point, range: number): Target[] {
    return this.game.targets.filter((t) => t.hp > 0 && distance(t, origin) <= range);
  }
  // Live particles matching `near`, in the order the electron reaches them going forward.
  private alongOrbit(near: (target: Target) => boolean): Target[] {
    const g = this.game;
    return g.targets
      .filter((t) => t.hp > 0 && near(t))
      .sort((a, b) => ahead(a.angle, g.angle) - ahead(b.angle, g.angle) || a.id - b.id);
  }

  // Each primary also queues its Repeat hits; Fork splits the damage across primaries.
  private volley(attack: Attack, origin: Point, selected: Target[], anchored: Anchor): number {
    const g = this.game,
      f = g.forms;
    let fired = 0;
    if (g.ranks.multi && selected.length > 1) attack.fork = true;
    for (const [i, target] of selected.entries()) {
      if (target.hp <= 0) continue;
      const branch =
        i && g.ranks.multi ? this.derive(attack, attack.damage * f.multi.damage) : attack;
      for (let hit = 1; hit < f.repeat.hits; hit++)
        this.schedule(hit * g.rules.skills.repeat.delaySeconds, {
          kind: 'hit',
          attack: this.derive(branch, branch.damage * f.repeat.damage),
          target,
          from: { ...origin },
          anchored,
        });
      this.emit(branch, origin, target, anchored);
      fired++;
    }
    if (fired > 1) this.activate('multi');
    if (fired > 1 && g.evolved.multi && attack.depth === 0) this.link(attack, selected);
    return fired;
  }

  // Evolved Fork: a bolt joins each primary to the next.
  private link(attack: Attack, selected: Target[]): void {
    const damage = attack.damage * this.game.rules.skills.multi.evolution.linkDamage,
      link = this.derive(attack, damage, 2),
      alive = selected.filter((t) => t.hp > 0);
    for (const [i, target] of alive.entries()) {
      const next = alive[(i + 1) % alive.length];
      if (next === target || (alive.length === 2 && i === 1)) continue;
      this.effect(link, 'bolt', target, next, { source: 'multi', width: 1.3 });
      this.deal(link, next, damage);
    }
  }

  private repeatHit(work: Extract<Work, { kind: 'hit' }>): void {
    const g = this.game,
      anchored = work.anchored,
      from =
        typeof anchored === 'number'
          ? (this.satellites[anchored] ?? work.from)
          : anchored
            ? g.position
            : work.from;
    const target =
      work.target && work.target.hp > 0 && g.targets.includes(work.target)
        ? work.target
        : closest(g.targets, from, 1, work.attack.range)[0];
    if (!target) return;
    this.emit(work.attack, from, target, anchored, true);
    this.activate('repeat');
    // Evolved Repeat: a kill adds one more hit, so the stream runs on while kills do.
    const extra = work.attack.extra ?? 0;
    if (target.hp <= 0 && g.evolved.repeat && extra < g.rules.skills.repeat.evolution.maxExtra)
      this.schedule(g.rules.skills.repeat.delaySeconds, {
        kind: 'hit',
        attack: { ...work.attack, extra: extra + 1 },
        from: work.from,
        anchored,
      });
  }

  // A Thunderstrike falls from above and splashes; every fired bolt may come back as Return.
  private emit(
    attack: Attack,
    origin: Point,
    target: Target,
    anchored: Anchor,
    repeated = false,
  ): void {
    const g = this.game,
      f = g.forms,
      source = repeated ? 'repeat' : (attack.source ?? (g.ranks.multi ? 'multi' : undefined)),
      strike = attack.source === 'strike' && !repeated,
      point = { x: target.x, y: target.y };
    if (strike)
      this.effect(
        attack,
        'strike',
        { x: point.x, y: point.y - 300 },
        target,
        { radius: f.strike.splash, life: 0.3, source },
        target.id,
      );
    else this.effect(attack, 'bolt', origin, target, { anchored, source }, target.id);
    this.resolve(attack, target, origin, anchored);
    if (strike) {
      const splash = this.derive(
        attack,
        attack.damage * g.rules.skills.strike.splash.damage,
        Math.max(1, attack.depth),
      );
      for (const other of this.within(point, f.strike.splash))
        if (other !== target) this.deal(splash, other, splash.damage);
    }
    if (g.ranks.return && attack.depth === 0)
      this.schedule(g.rules.skills.return.delaySeconds, {
        kind: 'return',
        attack: { ...this.derive(attack, attack.damage * f.return.damage, 1), source: 'return' },
        point,
      });
  }

  // The primary hit, then Pierce's line, Chain's hops and Death Arc's burst.
  private resolve(attack: Attack, primary: Target, origin: Point, anchored: Anchor = false): void {
    if (primary.hp <= 0) return;
    const g = this.game,
      pierce = g.forms.pierce,
      visited = new Set([primary.id]),
      contact = { x: primary.x, y: primary.y };
    this.deal(attack, primary, attack.damage);
    if (pierce.length) {
      const toward = distance(contact, origin) > 0.001 ? contact : g.position,
        direction = norm({ x: toward.x - origin.x, y: toward.y - origin.y });
      const to = {
          x: origin.x + direction.x * pierce.length,
          y: origin.y + direction.y * pierce.length,
        },
        damage = attack.damage * g.rules.skills.pierce.damage;
      this.effect({ ...attack, damage }, 'pierce', origin, to, {
        anchored,
        source: 'pierce',
        width: pierce.width,
      });
      this.activate('pierce');
      for (const target of onSegment(g.targets, origin, to, pierce.width)) {
        if (visited.has(target.id)) continue;
        visited.add(target.id);
        this.deal(attack, target, damage, { style: 'sweep', from: origin });
      }
      // Evolved: the line stays and keeps hitting for a while.
      const cfg = g.rules.skills.pierce.evolution;
      if (g.evolved.pierce && attack.depth === 0 && this.trails.length < cfg.maxTrails)
        this.trails.push({
          attack: this.derive(attack, attack.damage * cfg.trailDamage, 2),
          from: { ...origin },
          to: { ...to },
          width: pierce.width,
          until: g.time + cfg.trailSeconds,
          next: g.tick + cfg.trailInterval * g.rules.time.tickRate,
        });
    }
    this.chain(attack, contact, visited);
    this.discharge(attack);
  }

  private chain(attack: Attack, from: Point, visited: Set<number>): void {
    const g = this.game,
      { hops, range } = g.forms.chain;
    let previous = from;
    for (let hop = 0; hop < hops; hop++) {
      const next = closest(g.targets, previous, 1, range, visited)[0];
      if (!next) break;
      visited.add(next.id);
      const damage = attack.damage * g.rules.skills.chain.falloff ** (hop + 1);
      this.effect({ ...attack, damage }, 'bolt', previous, next, { source: 'chain', width: 1.3 });
      this.activate('chain');
      previous = { x: next.x, y: next.y };
      this.deal(attack, next, damage, { style: 'tap' });
    }
    if (!g.evolved.chain || !hops) return;
    // Evolved: the bolt turns back through the same stretch at reduced power.
    const returned = new Set<number>(),
      loop = g.rules.skills.chain.evolution.loopDamage;
    for (let hop = 0; hop < hops; hop++) {
      const next = closest(g.targets, previous, 2, range, returned).find(
        (t) => distance(t, previous) > 1e-6,
      );
      if (!next) break;
      returned.add(next.id);
      const damage = attack.damage * loop * g.rules.skills.chain.falloff ** (hop + 1);
      this.effect({ ...attack, damage }, 'bolt', previous, next, { source: 'chain', width: 1.3 });
      previous = { x: next.x, y: next.y };
      this.deal(attack, next, damage, { style: 'tap' });
    }
  }

  // Death Arc: an attack's first kill throws a burst at the particles around it, once.
  // Evolved, or under Greed, the particles it pops discharge again, a few levels deeper.
  private discharge(attack: Attack): void {
    const g = this.game,
      f = g.forms,
      limit =
        (g.evolved.burst ? g.rules.skills.burst.evolution.depth : 2) +
        (g.pacts.greed ? g.rules.pacts.greed.depth : 0);
    if (!attack.firstKill || !g.ranks.burst || attack.budget.burst || attack.depth >= limit) return;
    attack.budget.burst = true;
    const from = attack.firstKill,
      targets = closest(g.targets, from, f.burst.count + f.multi.count - 1, f.burst.radius),
      child = this.secondary(attack, 'burst', f.burst.damage);
    if (g.evolved.burst || g.pacts.greed) child.budget = { burst: false };
    if (targets.length) this.activate('burst');
    this.volley(child, from, targets, false);
  }

  // Return: the bolt comes back from where it struck to the electron or its satellite.
  // Evolved, it then goes back out once more (`outward`).
  private reverse(attack: Attack, point: Point, outward = false): void {
    const g = this.game,
      electron =
        attack.satellite === undefined
          ? g.position
          : (this.satellites[attack.satellite] ?? g.position);
    const [from, to] = outward ? [electron, point] : [point, electron],
      targets = onSegment(g.targets, from, to, g.forms.return.width);
    this.effect(attack, 'return', from, to, { life: 0.2, source: 'return' });
    this.activate('return');
    // One shared visit set keeps the swept path and its chain from doubling hits.
    const visited = new Set(targets.map((t) => t.id));
    for (const target of targets)
      this.deal(attack, target, attack.damage, { style: 'sweep', from });
    this.chain(attack, targets.at(-1) ?? from, visited);
    this.discharge(attack);
    if (g.evolved.return && !attack.spent)
      this.schedule(g.rules.skills.return.delaySeconds, {
        kind: 'return',
        attack: {
          ...this.derive(attack, attack.damage * g.rules.skills.return.evolution.echoDamage),
          spent: true,
          budget: { burst: false },
        },
        point,
        outward: true,
      });
  }

  // Thunderstrike at rank 5: one more bolt joins every impact point.
  private thunder(attack: Attack, targets: Target[]): void {
    const g = this.game,
      cfg = g.rules.skills.strike.thunder;
    g.log('thunder', { count: targets.length });
    if (g.ranks.strike < g.rules.growth.maxRank || targets.length < 2) return;
    const link = this.derive(attack, attack.damage * cfg.damage, 2),
      hit = new Set<number>();
    for (let i = 1; i < targets.length; i++) {
      const from = targets[i - 1],
        to = targets[i];
      this.effect(link, 'bolt', from, to, { life: 0.22, source: 'strike', width: 2.4 });
      for (const target of onSegment(g.targets, from, to, cfg.width))
        if (!hit.has(target.id)) (hit.add(target.id), this.deal(link, target, link.damage));
    }
  }

  // Evolved Thunderstrike: bolts keep falling between the regular strikes.
  private updateStorm(): void {
    const g = this.game;
    if (!g.evolved.strike || !g.ranks.strike || g.tick + 1e-8 < this.nextStorm) return;
    const cfg = g.rules.skills.strike.evolution;
    this.nextStorm = g.tick + (cfg.stormSeconds / g.rate) * g.rules.time.tickRate;
    const pool = this.strongest(g.position, g.forms.strike.range, 3);
    if (!pool.length) return;
    const target = pool[this.stormTurn++ % pool.length];
    this.emit(this.begin('strike', g.forms.strike.damage * cfg.damage), g.position, target, false);
  }

  // Charged Bolt: sparks scatter, one per direction around the electron, popping in turn.
  private fireSpark(attack: Attack, origin: Point): boolean {
    const g = this.game,
      s = g.forms.spark,
      near = this.within(origin, s.range);
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
    for (const t of closest(near, origin, s.count, s.range, new Set(chosen.map((c) => c.id))))
      if (chosen.length < s.count) chosen.push(t);
    const spark = { ...attack, depth: 1 };
    chosen.forEach((target, i) =>
      this.schedule(i * g.rules.skills.spark.popSeconds, {
        kind: 'pop',
        attack: spark,
        target,
        from: { ...origin },
      }),
    );
    this.activate('spark');
    return true;
  }

  // Static Field: weak particles in the field pop together; giant particles lose a share of health.
  private fireField(attack: Attack, origin: Point): boolean {
    const g = this.game,
      s = g.forms.field,
      targets = this.within(origin, s.radius);
    if (!targets.length) return false;
    const field = { ...attack, depth: 1 };
    this.effect(field, 'field', origin, origin, { radius: s.radius, life: 0.35, anchored: true });
    for (const target of targets) {
      const share = target.final ? g.rules.skills.field.finalScale : 1;
      this.deal(
        field,
        target,
        target.kind === 'boss' ? target.hp * s.bossFraction * share : field.damage,
      );
    }
    this.activate('field');
    return true;
  }

  // Evolved Static Field: a particle it pops leaves a small field behind.
  private remnant(attack: Attack, at: Point): void {
    const g = this.game,
      cfg = g.rules.skills.field.evolution,
      damage = attack.power * g.forms.field.damage * cfg.damage;
    this.effect(attack, 'field', at, at, { radius: cfg.radius, life: 0.25 });
    for (const target of closest(g.targets, at, 12, cfg.radius))
      this.deal({ ...attack, damage }, target, damage);
  }

  private fireSatellite(attack: Attack): boolean {
    const g = this.game,
      f = g.forms,
      branches = f.multi.count,
      reserved = new Set<number>();
    let fired = 0;
    for (const [index, point] of this.satellites.entries()) {
      // Satellites spread over different particles before sharing one.
      const targets = closest(g.targets, point, branches, f.satellite.range, reserved);
      if (targets.length < branches) {
        const shared = g.targets.filter((t) => reserved.has(t.id));
        targets.push(...closest(shared, point, branches - targets.length, f.satellite.range));
      }
      targets.forEach((t) => reserved.add(t.id));
      fired += this.volley(
        { ...attack, satellite: index, range: f.satellite.range },
        point,
        targets,
        index,
      );
    }
    if (fired && g.evolved.satellite) this.ring(attack);
    if (fired) this.activate('satellite');
    return fired > 0;
  }

  // Evolved Satellite: the satellites are joined into a ring of current.
  private ring(attack: Attack): void {
    const g = this.game,
      cfg = g.rules.skills.satellite.evolution,
      points = this.satellites,
      ring = this.derive(attack, attack.damage * cfg.ringDamage, 2),
      hit = new Set<number>();
    if (points.length < 2) return;
    for (const [i, from] of points.entries()) {
      const to = points[(i + 1) % points.length];
      this.effect(ring, 'pierce', from, to, { source: 'satellite', width: cfg.width });
      for (const target of onSegment(g.targets, from, to, cfg.width))
        if (!hit.has(target.id)) (hit.add(target.id), this.deal(ring, target, ring.damage));
    }
  }

  // Fission: a popped particle takes its nearest neighbours with it.
  private split(attack: Attack, from: Point): void {
    const g = this.game,
      generation = (attack.generation ?? 0) + 1,
      // Evolved: each later split reaches further.
      growth = g.evolved.fission
        ? 1 + g.rules.skills.fission.evolution.radiusGrowth * (generation - 1)
        : 1,
      targets = closest(
        g.targets,
        from,
        g.rules.skills.fission.targets,
        g.forms.fission.radius * growth,
      );
    if (!targets.length) return;
    const child = { ...attack, generation };
    for (const target of targets) {
      this.effect(child, 'bolt', from, target, { source: 'fission', width: 1.3 }, target.id);
      this.deal(child, target, child.damage);
    }
    this.activate('fission');
  }

  // Overcharge: kills heat the electron until the whole orbit band discharges in order.
  // Evolved, the discharge echoes once at `evolution.damage` of its strength.
  private overcharge(scale: number, echo = false): void {
    const g = this.game,
      s = g.forms.overcharge,
      attack = { ...this.begin('overcharge', s.damage * scale), depth: 2 };
    this.effect(attack, 'field', CENTER, CENTER, { radius: g.radius, life: 0.4 });
    const targets = this.alongOrbit((t) => Math.abs(t.radius - g.radius) <= s.band);
    this.popInOrder(attack, undefined, targets, g.rules.skills.overcharge.popSeconds);
    this.activate('overcharge');
    if (!echo && g.evolved.overcharge) {
      const cfg = g.rules.skills.overcharge.evolution;
      this.schedule(cfg.delaySeconds, { kind: 'overcharge', attack, scale: cfg.damage });
    }
  }

  // Static Mark: once enough live particles carry a mark, they pop in a chain from the electron.
  private detonate(attack: Attack): void {
    const g = this.game,
      marked = g.targets.filter((t) => t.marked && t.hp > 0);
    this.marked = new Set(marked.map((t) => t.id));
    if (marked.length < g.forms.mark.threshold) return;
    this.marked.clear();
    const ordered: Target[] = [],
      left = new Set(marked);
    let from: Point = g.position;
    while (left.size) {
      let next = marked[0],
        best = Infinity;
      for (const t of left) if (distance(t, from) < best) [next, best] = [t, distance(t, from)];
      left.delete(next);
      next.marked = false;
      ordered.push((from = next));
    }
    const child = { ...this.secondary(attack, 'mark', g.forms.mark.damage), depth: 2 };
    this.popInOrder(child, g.position, ordered, g.rules.skills.mark.popSeconds);
    this.activate('mark');
    if (!g.evolved.mark) return;
    // Evolved: each detonation passes fresh marks to unmarked neighbours.
    const cfg = g.rules.skills.mark.evolution,
      popping = new Set(ordered.map((t) => t.id));
    for (const source of ordered)
      for (const next of closest(g.targets, source, cfg.spread, cfg.radius, popping)) {
        if (next.marked) continue;
        next.marked = true;
        this.marked.add(next.id);
      }
  }

  resonate(beat: 1 | 2 | 3): void {
    const g = this.game,
      cfg = g.rules.combat.resonance,
      multiplier = beat === 3 ? cfg.finishDamage : cfg.beatDamage,
      attack = this.begin(undefined, multiplier);
    attack.power *= multiplier;
    if (beat !== 3) {
      this.volley(attack, g.position, closest(g.targets, g.position, 1, attack.range), true);
      return;
    }
    // One global hit per particle; link cascades stay on the first two beats.
    attack.depth = 2;
    for (const target of [...g.targets]) this.deal(attack, target, attack.damage);
  }

  // Tempo Coil and the Pulse pact: each accepted beat sweeps forward along the orbit,
  // popping in order.
  sweep(beat: 1 | 2 | 3): void {
    const g = this.game;
    if (g.ranks.tempo) {
      const s = g.forms.tempo,
        cfg = g.rules.skills.tempo,
        whole = beat === 3 && g.evolved.tempo;
      // Evolved: the third beat sweeps the whole lap, a little softer per particle.
      const count = whole ? Infinity : s.count * (beat === 3 ? cfg.finishScale : 1),
        damage = whole ? s.damage * cfg.evolution.damage : s.damage;
      if (this.sweepOrbit('tempo', s.band, count, damage)) this.activate('tempo');
    }
    if (g.pacts.pulse) {
      const p = g.rules.pacts.pulse;
      this.sweepOrbit(undefined, g.forms.tempo.band || 24, p.count, p.damage);
    }
  }

  private sweepOrbit(source: SkillId | undefined, band: number, count: number, damage: number) {
    const g = this.game,
      targets = this.alongOrbit((t) => t.radius <= g.radius + band).slice(0, count);
    if (!targets.length) return false;
    const attack = { ...this.begin(source, damage), depth: 2 };
    this.popInOrder(attack, g.position, targets, g.rules.skills.tempo.popSeconds);
    return true;
  }

  private popInOrder(
    attack: Attack,
    start: Point | undefined,
    targets: Target[],
    gap: number,
  ): void {
    let from = start;
    for (const [i, target] of targets.entries()) {
      this.schedule(i * gap, { kind: 'pop', attack, target, from: from && { ...from } });
      if (from) from = { x: target.x, y: target.y };
    }
  }

  private pop(attack: Attack, target: Target, from?: Point): void {
    const g = this.game;
    if (target.hp <= 0 || !g.targets.includes(target)) return;
    if (from) this.effect(attack, 'bolt', from, target, { width: 1.3 }, target.id);
    this.deal(attack, target, attack.damage);
    // Evolved Charged Bolt: each spark bounces once to a nearby particle.
    if (attack.source !== 'spark' || !g.evolved.spark || attack.spent) return;
    const cfg = g.rules.skills.spark.evolution,
      next = closest(g.targets, target, 1, cfg.bounceRange, new Set([target.id]))[0];
    if (next)
      this.schedule(g.rules.skills.spark.popSeconds * 2, {
        kind: 'pop',
        attack: { ...attack, spent: true, damage: attack.damage * cfg.bounceDamage },
        target: next,
        from: { x: target.x, y: target.y },
      });
  }

  private updateTrails(): void {
    const g = this.game,
      cfg = g.rules.skills.pierce.evolution;
    this.trails = this.trails.filter((trail) => g.time < trail.until - 1e-8);
    for (const trail of this.trails) {
      if (g.tick + 1e-8 < trail.next) continue;
      trail.next = g.tick + cfg.trailInterval * g.rules.time.tickRate;
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
      start = g.angle - sweep,
      attack = { ...this.begin(undefined, cfg.damage), depth: 1 };
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

  // Charging skills sound each quarter they fill, so a release has a build-up before it.
  private build(id: Building, progress: number): void {
    const step = Math.floor(progress * 4 + 1e-8);
    if (step > (this.building[id] ?? 0) && step < 4) this.game.log('build', { id, step });
    this.building[id] = step;
  }

  private chargeSurge(amount: number): void {
    const g = this.game,
      s = this.surge,
      cfg = g.rules.skills.surge;
    if (!g.ranks.surge || this.surging) return;
    if (g.time - s.last > cfg.windowSeconds) s.charge = 0;
    s.last = g.time;
    s.charge += amount;
    this.build('surge', s.charge / g.forms.surge.kills);
    if (s.charge < g.forms.surge.kills) return;
    s.charge = 0;
    this.build('surge', 0);
    s.until = g.time + g.forms.surge.duration;
    s.extended = 0;
    s.next = g.tick + 1;
    s.attack = this.begin('surge', g.forms.surge.damage);
    this.activate('surge');
    this.effect(s.attack, 'surge', g.position, g.position, {
      radius: 12,
      life: s.until - g.time,
      anchored: true,
    });
  }

  private updateSurge(): void {
    const g = this.game,
      s = this.surge;
    if (!this.surging || !s.attack || g.tick < s.next) return;
    const attack = { ...s.attack, budget: { burst: false }, firstKill: undefined };
    this.volley(
      attack,
      g.position,
      closest(g.targets, g.position, g.forms.multi.count, attack.range),
      true,
    );
    s.next =
      g.tick + Math.max(0.05, g.rules.skills.surge.tickSeconds / g.rate) * g.rules.time.tickRate;
  }

  // Every particle that pops feeds Surge, Overheat, Overcharge, Fission and an evolved Field.
  private killed(attack: Attack, at: Point): void {
    const g = this.game,
      s = this.surge,
      surging = this.surging;
    // The kill that starts a surge does not also extend it.
    this.chargeSurge(1);
    if (g.evolved.surge && surging) {
      const cfg = g.rules.skills.surge.evolution,
        add = Math.min(cfg.extendSeconds, cfg.maxExtend - s.extended);
      if (add > 0) ((s.until += add), (s.extended += add));
    }
    if (g.pacts.overheat) {
      this.streak = Math.min(g.rules.pacts.overheat.maxStacks, this.streak + 1);
      this.lastKill = g.time;
    }
    if (g.ranks.overcharge && attack.source !== 'overcharge') {
      this.overchargeKills++;
      this.build('overcharge', this.overchargeKills / g.forms.overcharge.kills);
      if (this.overchargeKills >= g.forms.overcharge.kills) {
        this.overchargeKills = 0;
        this.build('overcharge', 0);
        this.overcharge(1);
      }
    }
    const generation = attack.source === 'fission' ? (attack.generation ?? 0) : 0,
      depth = g.forms.fission.depth + (g.pacts.greed ? g.rules.pacts.greed.depth : 0);
    if (g.ranks.fission && generation < depth)
      this.schedule(g.rules.skills.fission.delaySeconds, {
        kind: 'split',
        attack: { ...this.begin('fission', g.forms.fission.damage), generation, depth: 2 },
        point: at,
      });
    if (attack.source === 'field' && !attack.spent && g.evolved.field)
      this.schedule(g.rules.skills.field.evolution.delaySeconds, {
        kind: 'remnant',
        attack: { ...attack, spent: true, depth: 2 },
        point: at,
      });
  }

  // Pact modifiers apply to every hit; critical hits roll on their own stream.
  // A hit then feeds Blast, Static Mark, Surge and Capacitor.
  deal(attack: Attack, target: Target, base: number, pop?: Pop): void {
    if (target.hp <= 0) return;
    const g = this.game,
      f = g.forms,
      pacts = g.rules.pacts,
      at = { x: target.x, y: target.y };
    let damage = base;
    if (g.pacts.horizon) damage *= 1 + g.mass * pacts.horizon.damagePerMass;
    if (g.pacts.blast) damage *= pacts.blast.damageScale;
    const crit = g.critRoll() < critChance(g.boosts.crit, g.rules);
    if (crit)
      damage *= g.pacts.gamble ? pacts.gamble.critMultiplier : g.rules.combat.crit.multiplier;
    else if (g.pacts.gamble) damage *= pacts.gamble.normalScale;
    const style =
      pop?.style ??
      (attack.source ? g.rules.skills[attack.source].pop : attack.fork ? 'burst' : 'tap');
    g.damageTarget(target, damage, crit, style, pop?.from);
    if (target.hp <= 0) {
      attack.firstKill ??= at;
      this.killed(attack, at);
    }
    // Blast pact: a fired hit splashes the particles around it.
    if (g.pacts.blast && attack.depth === 0) {
      const splash = attack.power * pacts.blast.damage,
        child = this.derive(attack, attack.damage, 2);
      for (const other of closest(g.targets, at, 8, pacts.blast.radius))
        if (other !== target) this.deal(child, other, splash);
    }
    if (g.ranks.mark && attack.depth < 2 && target.hp > 0 && !target.marked) {
      target.marked = true;
      this.marked.add(target.id);
      if (this.marked.size >= f.mark.threshold) this.detonate(attack);
    }
    if (target.hp > 0 && attack.source !== 'surge' && g.time >= this.surge.nextHit) {
      this.surge.nextHit = g.time + g.rules.skills.surge.hitIntervalSeconds;
      this.chargeSurge(g.rules.skills.surge.hitCharge * Math.min(1, damage / attack.power));
    }
    if (g.ranks.charge && attack.source !== 'charge' && attack.depth < 2)
      this.capacitor(attack, target, damage);
  }

  // Capacitor: hits store charge until a heavy bolt discharges at the struck or nearest particle.
  private capacitor(attack: Attack, target: Target, damage: number): void {
    const g = this.game,
      threshold = g.forms.charge.threshold;
    this.stored = Math.min(threshold, this.stored + Math.min(1, damage / attack.power));
    this.build('charge', this.stored / threshold);
    const recipient = target.hp > 0 ? target : closest(g.targets, g.position, 1, attack.range)[0];
    if (!recipient || this.stored + 1e-8 < threshold) {
      // The glow's width carries how full the capacitor is.
      const style = {
        radius: 10,
        life: 0.3,
        anchored: true,
        source: 'charge' as const,
        width: this.stored / threshold,
      };
      return this.effect(attack, 'charge', g.position, g.position, style);
    }
    this.stored = 0;
    this.build('charge', 0);
    const charged = this.secondary(attack, 'charge', g.forms.charge.damage);
    this.effect(charged, 'bolt', g.position, recipient, {
      life: 0.2,
      anchored: true,
      source: 'charge',
      width: 4,
    });
    this.activate('charge');
    this.resolve(charged, recipient, g.position, true);
    if (g.evolved.charge) this.chargeRing(charged);
  }

  // Evolved Capacitor: a full discharge also spreads as a ring around the electron.
  private chargeRing(charged: Attack): void {
    const g = this.game,
      cfg = g.rules.skills.charge.evolution,
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

  private effect(
    attack: Attack,
    kind: Effect['kind'],
    from: Point,
    to: Point,
    style: Style = {},
    targetId?: number,
  ) {
    const g = this.game,
      { radius = 0, life = 0.14, anchored = false, source = attack.source, width = 1.8 } = style;
    g.addEffect({
      kind,
      from,
      to,
      radius,
      width,
      life,
      damage: ['bolt', 'strike', 'pierce', 'return'].includes(kind) ? attack.damage : 0,
      source,
      rarity: (source && g.rarities[source]) || 'common',
      rank: source ? g.ranks[source] : 0,
      anchor: typeof anchored === 'number' ? anchored : anchored ? 'electron' : undefined,
      endAnchor: kind === 'return' ? (attack.satellite ?? 'electron') : undefined,
      targetId,
    });
  }

  private activate(id: SkillId): void {
    const g = this.game;
    if (!g.ranks[id]) return;
    this.fired[id] = g.time;
    if (linkedSkills.includes(id))
      this.nextLinked[id] = g.tick + g.attackInterval * g.rules.time.tickRate;
    g.log('skill-effect', { id, rank: g.ranks[id] });
  }
}
