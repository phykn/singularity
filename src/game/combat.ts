import { Charges } from './charges.ts';
import type { Game } from './Game.ts';
import { TAU, ahead, at, distance, norm } from './geometry.ts';
import type { Point } from './geometry.ts';
import { Pacts } from './pacts.ts';
import type { PopStyle, SkillId } from './rules.ts';
import { critChance, linkedSkills, powerScale, rangeScale, timedSkills } from './skills.ts';
import type { TimedSkill } from './skills.ts';
import { closest, onSegment } from './targeting.ts';
import { Timed } from './timed.ts';
import type { Effect, Target } from './types.ts';

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
type Style = {
  radius?: number;
  life?: number;
  anchored?: Anchor;
  source?: SkillId;
  width?: number;
};
type SkillStatus = {
  mode: 'linked' | 'timed' | 'charging' | 'conditional';
  progress: number;
  active: boolean;
  fired: boolean;
};
// An evolved Pierce line that keeps hitting for a while.
type Trail = { attack: Attack; from: Point; to: Point; width: number; until: number; next: number };

// The attack pipeline: a volley of primaries, each hit resolving into the linked skills
// (Repeat, Pierce, Chain, Death Arc, Return, Fission), with later hits scheduled by tick.
export class Combat {
  readonly game: Game;
  readonly pacts: Pacts;
  readonly charges: Charges;
  readonly timed: Timed;
  private nextAttack: number;
  private nextLinked: Partial<Record<SkillId, number>> = {};
  private scheduled: { at: number; order: number; run: () => void }[] = [];
  private order = 0;
  private fired: Partial<Record<SkillId, number>> = {};
  private trails: Trail[] = [];

  constructor(game: Game) {
    this.game = game;
    this.pacts = new Pacts(this);
    this.charges = new Charges(this);
    this.timed = new Timed(this);
    this.nextAttack = game.rules.combat.attackSeconds * game.rules.time.tickRate;
  }

  get range(): number {
    const g = this.game;
    return g.rules.orbit.range * rangeScale(g.growth.boosts.range, g.rules);
  }
  get damage(): number {
    const g = this.game;
    return g.rules.combat.baseDamage * powerScale(g.growth.boosts.power, g.rules);
  }
  get rate(): number {
    const g = this.game;
    return (1 + g.rules.combat.ratePerRank * g.growth.boosts.rate) * this.pacts.heatScale;
  }
  get attackInterval(): number {
    return this.game.rules.combat.attackSeconds / this.rate;
  }
  get satellites(): Point[] {
    const g = this.game,
      s = g.rules.skills.satellite,
      count = g.growth.values.satellite.count,
      center = g.position;
    return Array.from({ length: count }, (_, i) => {
      const angle = g.time * s.angularSpeed + (i * TAU) / count;
      return {
        x: center.x + Math.cos(angle) * s.orbitRadius,
        y: center.y + Math.sin(angle) * s.orbitRadius,
      };
    });
  }

  // Drops attacks in flight and lingering effects, for a field that is emptied.
  clear(): void {
    this.scheduled = [];
    this.trails = [];
    this.charges.clear();
    this.pacts.clear();
  }

  update(): void {
    const g = this.game,
      due = this.scheduled.filter((w) => w.at <= g.tick + 1e-8);
    if (due.length) {
      this.scheduled = this.scheduled.filter((w) => w.at > g.tick + 1e-8);
      for (const work of due.sort((a, b) => a.at - b.at || a.order - b.order)) work.run();
    }
    this.pacts.cool();
    const cooling = this.pacts.cooling;
    if (
      g.combatEnabled &&
      !cooling &&
      g.tick + 1e-8 >= this.nextAttack &&
      (g.growth.pacts.quiet ? this.pacts.bank() : this.fireBasic())
    ) {
      // Regular fire keeps its fractional cadence; an attack that waited idle starts afresh.
      const from = g.tick - this.nextAttack < 1 + 1e-8 ? this.nextAttack : g.tick;
      this.nextAttack = from + this.attackInterval * g.rules.time.tickRate;
    }
    this.pacts.release();
    if (!cooling) this.timed.fireDue();
    this.timed.storm();
    this.updateTrails();
    this.pacts.current();
    this.charges.update();
  }

  // What the loadout shows for a skill: its cooldown, its charge, or nothing to wait for.
  status(id: SkillId): SkillStatus {
    const g = this.game,
      fired = g.phase === 'running' && g.time - (this.fired[id] ?? -1) < 0.16;
    if (id === 'surge' || id === 'charge' || id === 'mark' || id === 'overcharge') {
      const { filled, needed, active = false } = this.charges.status(id);
      return { mode: 'charging', progress: Math.min(1, filled / needed), active, fired };
    }
    if (id === 'burst' || id === 'tempo' || id === 'fission')
      return { mode: 'conditional', progress: 0, active: false, fired };
    const timed = (timedSkills as readonly SkillId[]).includes(id),
      interval = timed
        ? this.timed.period(id as TimedSkill)
        : this.attackInterval * g.rules.time.tickRate,
      next = timed ? this.timed.next[id as TimedSkill] : (this.nextLinked[id] ?? g.tick),
      progress = Math.max(0, Math.min(1, 1 - (next - g.tick) / interval));
    return { mode: timed ? 'timed' : 'linked', progress, active: false, fired };
  }

  learn(id: SkillId): void {
    if ((timedSkills as readonly SkillId[]).includes(id)) this.timed.learn(id as TimedSkill);
  }

  // A rate change stretches the waits already under way.
  rescale(oldRate: number): void {
    const tick = this.game.tick,
      rate = this.rate,
      stretch = (time: number) => tick + Math.max(0, time - tick) * (oldRate / rate);
    this.nextAttack = stretch(this.nextAttack);
    this.charges.rescale(stretch);
    this.timed.rescale(stretch);
    for (const id of Object.keys(this.nextLinked) as SkillId[])
      this.nextLinked[id] = stretch(this.nextLinked[id]!);
  }

  schedule(seconds: number, run: () => void): void {
    const g = this.game;
    this.scheduled.push({ at: g.tick + seconds * g.rules.time.tickRate, order: this.order++, run });
  }

  begin(source?: SkillId, multiplier = 1): Attack {
    const damage = this.damage;
    return {
      power: damage,
      damage: damage * multiplier,
      range: this.range,
      source,
      depth: 0,
      budget: { burst: false },
    };
  }
  // A follow-up hit carries the attack's modifiers but starts its own first kill.
  derive(attack: Attack, damage: number, depth = attack.depth): Attack {
    return { ...attack, damage, depth, firstKill: undefined };
  }
  secondary(attack: Attack, source: SkillId, multiplier: number): Attack {
    return { ...this.derive(attack, attack.power * multiplier, attack.depth + 1), source };
  }

  within(origin: Point, range: number): Target[] {
    return this.game.targets.filter((t) => t.hp > 0 && distance(t, origin) <= range);
  }
  strongest(origin: Point, range: number, count: number): Target[] {
    return this.within(origin, range)
      .sort((a, b) => b.maxHp - a.maxHp || a.hp - b.hp || a.radius - b.radius || a.id - b.id)
      .slice(0, count);
  }
  // Live particles matching `near`, in the order the electron reaches them going forward.
  alongOrbit(near: (target: Target) => boolean): Target[] {
    const g = this.game;
    return g.targets
      .filter((t) => t.hp > 0 && near(t))
      .sort((a, b) => ahead(a.angle, g.angle) - ahead(b.angle, g.angle) || a.id - b.id);
  }

  fireBasic(origin: Point = this.game.position, multiplier = 1, count?: number): boolean {
    const g = this.game,
      attack = this.begin(undefined, multiplier),
      limit = count ?? g.growth.values.multi.count,
      selected = closest(g.targets, origin, limit, attack.range);
    // Basic fire always answers the boss, so builds without single-target skills can fight it.
    const boss = g.giants.boss;
    if (boss && !selected.includes(boss) && distance(boss, origin) <= attack.range) {
      selected.unshift(boss);
      selected.length = Math.min(selected.length, limit);
    }
    this.volley(attack, origin, selected, true);
    return selected.length > 0;
  }

  // Each primary also queues its Repeat hits; Fork splits the damage across primaries.
  volley(attack: Attack, origin: Point, selected: Target[], anchored: Anchor): number {
    const g = this.game,
      { ranks, values, evolved } = g.growth;
    let fired = 0;
    if (ranks.multi && selected.length > 1) attack.fork = true;
    for (const [i, target] of selected.entries()) {
      if (target.hp <= 0) continue;
      const branch =
          i && ranks.multi ? this.derive(attack, attack.damage * values.multi.damage) : attack,
        from = at(origin);
      for (let hit = 1; hit < values.repeat.hits; hit++) {
        const repeat = this.derive(branch, branch.damage * values.repeat.damage);
        this.schedule(hit * g.rules.skills.repeat.delaySeconds, () =>
          this.repeat(repeat, from, anchored, target),
        );
      }
      this.emit(branch, origin, target, anchored);
      fired++;
    }
    if (fired > 1) this.activate('multi');
    if (fired > 1 && evolved.multi && attack.depth === 0) this.link(attack, selected);
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

  // A Repeat hit lands on its target, or on the nearest particle once that one is gone.
  private repeat(attack: Attack, origin: Point, anchored: Anchor, aimed?: Target): void {
    const g = this.game,
      cfg = g.rules.skills.repeat,
      from =
        typeof anchored === 'number'
          ? (this.satellites[anchored] ?? origin)
          : anchored
            ? g.position
            : origin,
      target =
        aimed && aimed.hp > 0 && g.targets.includes(aimed)
          ? aimed
          : closest(g.targets, from, 1, attack.range)[0];
    if (!target) return;
    this.emit(attack, from, target, anchored, true);
    this.activate('repeat');
    // Evolved Repeat: a kill adds one more hit, so the stream runs on while kills do.
    const extra = attack.extra ?? 0;
    if (target.hp <= 0 && g.growth.evolved.repeat && extra < cfg.evolution.maxExtra)
      this.schedule(cfg.delaySeconds, () =>
        this.repeat({ ...attack, extra: extra + 1 }, origin, anchored),
      );
  }

  // A Thunderstrike falls from above and splashes; every fired bolt may come back as Return.
  emit(attack: Attack, origin: Point, target: Target, anchored: Anchor, repeated = false): void {
    const g = this.game,
      { ranks, values } = g.growth,
      source = repeated ? 'repeat' : (attack.source ?? (ranks.multi ? 'multi' : undefined)),
      strike = attack.source === 'strike' && !repeated,
      point = at(target);
    if (strike)
      this.effect(
        attack,
        'strike',
        { x: point.x, y: point.y - 300 },
        target,
        { radius: values.strike.splash, life: 0.3, source },
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
      for (const other of this.within(point, values.strike.splash))
        if (other !== target) this.deal(splash, other, splash.damage);
    }
    if (ranks.return && attack.depth === 0) {
      const back = {
        ...this.derive(attack, attack.damage * values.return.damage, 1),
        source: 'return' as const,
      };
      this.schedule(g.rules.skills.return.delaySeconds, () => this.reverse(back, point));
    }
  }

  // The primary hit, then Pierce's line, Chain's hops and Death Arc's burst.
  resolve(attack: Attack, primary: Target, origin: Point, anchored: Anchor = false): void {
    if (primary.hp <= 0) return;
    const g = this.game,
      pierce = g.growth.values.pierce,
      visited = new Set([primary.id]),
      contact = at(primary);
    this.deal(attack, primary, attack.damage);
    if (pierce.length) {
      const toward = distance(contact, origin) > 0.001 ? contact : g.position,
        direction = norm({ x: toward.x - origin.x, y: toward.y - origin.y }),
        to = {
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
        this.deal(attack, target, damage, 'sweep', origin);
      }
      // Evolved: the line stays and keeps hitting for a while.
      const cfg = g.rules.skills.pierce.evolution;
      if (g.growth.evolved.pierce && attack.depth === 0 && this.trails.length < cfg.maxTrails)
        this.trails.push({
          attack: this.derive(attack, attack.damage * cfg.trailDamage, 2),
          from: at(origin),
          to,
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
      cfg = g.rules.skills.chain,
      { hops, range } = g.growth.values.chain;
    let previous = from;
    const hop = (next: Target, damage: number) => {
      this.effect({ ...attack, damage }, 'bolt', previous, next, { source: 'chain', width: 1.3 });
      previous = at(next);
    };
    for (let i = 0; i < hops; i++) {
      const next = closest(g.targets, previous, 1, range, visited)[0];
      if (!next) break;
      visited.add(next.id);
      const damage = attack.damage * cfg.falloff ** (i + 1);
      hop(next, damage);
      this.activate('chain');
      this.deal(attack, next, damage, 'tap');
    }
    if (!g.growth.evolved.chain || !hops) return;
    // Evolved: the bolt turns back through the same stretch at reduced power.
    const returned = new Set<number>();
    for (let i = 0; i < hops; i++) {
      const next = closest(g.targets, previous, 2, range, returned).find(
        (t) => distance(t, previous) > 1e-6,
      );
      if (!next) break;
      returned.add(next.id);
      const damage = attack.damage * cfg.evolution.loopDamage * cfg.falloff ** (i + 1);
      hop(next, damage);
      this.deal(attack, next, damage, 'tap');
    }
  }

  // Death Arc: an attack's first kill throws a burst at the particles around it, once.
  // Evolved, or under Greed, the particles it pops discharge again, a few levels deeper.
  private discharge(attack: Attack): void {
    const g = this.game,
      { ranks, values, evolved, pacts } = g.growth,
      limit =
        (evolved.burst ? g.rules.skills.burst.evolution.depth : 2) +
        (pacts.greed ? g.rules.pacts.greed.depth : 0);
    if (!attack.firstKill || !ranks.burst || attack.budget.burst || attack.depth >= limit) return;
    attack.budget.burst = true;
    const from = attack.firstKill,
      targets = closest(
        g.targets,
        from,
        values.burst.count + values.multi.count - 1,
        values.burst.radius,
      ),
      child = this.secondary(attack, 'burst', values.burst.damage);
    if (evolved.burst || pacts.greed) child.budget = { burst: false };
    if (targets.length) this.activate('burst');
    this.volley(child, from, targets, false);
  }

  // Return: the bolt comes back from where it struck to the electron or its satellite.
  // Evolved, it then goes back out once more (`outward`).
  private reverse(attack: Attack, point: Point, outward = false): void {
    const g = this.game,
      cfg = g.rules.skills.return,
      home =
        attack.satellite === undefined
          ? g.position
          : (this.satellites[attack.satellite] ?? g.position),
      [from, to] = outward ? [home, point] : [point, home],
      targets = onSegment(g.targets, from, to, g.growth.values.return.width);
    this.effect(attack, 'return', from, to, { life: 0.2, source: 'return' });
    this.activate('return');
    // One shared visit set keeps the swept path and its chain from doubling hits.
    const visited = new Set(targets.map((t) => t.id));
    for (const target of targets) this.deal(attack, target, attack.damage, 'sweep', from);
    this.chain(attack, targets.at(-1) ?? from, visited);
    this.discharge(attack);
    if (!g.growth.evolved.return || attack.spent) return;
    const echo = {
      ...this.derive(attack, attack.damage * cfg.evolution.echoDamage),
      spent: true,
      budget: { burst: false },
    };
    this.schedule(cfg.delaySeconds, () => this.reverse(echo, point, true));
  }

  // Fission: a popped particle takes its nearest neighbours with it.
  private split(attack: Attack, from: Point): void {
    const g = this.game,
      cfg = g.rules.skills.fission,
      generation = (attack.generation ?? 0) + 1,
      // Evolved: each later split reaches further.
      growth = g.growth.evolved.fission ? 1 + cfg.evolution.radiusGrowth * (generation - 1) : 1,
      targets = closest(g.targets, from, cfg.targets, g.growth.values.fission.radius * growth);
    if (!targets.length) return;
    const child = { ...attack, generation };
    for (const target of targets) {
      this.effect(child, 'bolt', from, target, { source: 'fission', width: 1.3 }, target.id);
      this.deal(child, target, child.damage);
    }
    this.activate('fission');
  }

  // Pops `targets` one after another, `gap` seconds apart; with a start, a bolt joins each
  // to the one before.
  popInOrder(attack: Attack, start: Point | undefined, targets: Target[], gap: number): void {
    let from = start;
    for (const [i, target] of targets.entries()) {
      const origin = from && at(from);
      this.schedule(i * gap, () => this.pop(attack, target, origin));
      if (from) from = at(target);
    }
  }

  // Reports whether the particle was still there to hit.
  pop(attack: Attack, target: Target, from?: Point): boolean {
    if (target.hp <= 0 || !this.game.targets.includes(target)) return false;
    if (from) this.effect(attack, 'bolt', from, target, { width: 1.3 }, target.id);
    this.deal(attack, target, attack.damage);
    return true;
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

  // Pact modifiers apply to every hit; critical hits roll on their own stream. Kills pop in
  // `style`, or the attack's own; lines sweep outward from `from`.
  deal(attack: Attack, target: Target, base: number, style?: PopStyle, from?: Point): void {
    if (target.hp <= 0) return;
    const g = this.game,
      point = at(target),
      crit = g.crit.next() < critChance(g.growth.boosts.crit, g.rules),
      damage = this.pacts.critical(this.pacts.scale(base), crit);
    g.damageTarget(
      target,
      damage,
      crit,
      style ?? (attack.source ? g.rules.skills[attack.source].pop : attack.fork ? 'burst' : 'tap'),
      from,
    );
    if (target.hp <= 0) {
      attack.firstKill ??= point;
      this.killed(attack, point);
    }
    this.pacts.splash(attack, target, point);
    this.charges.struck(attack, target, damage);
  }

  // Every particle that pops feeds Surge, Overheat, Overcharge, Fission and an evolved Field.
  private killed(attack: Attack, point: Point): void {
    const g = this.game,
      { ranks, values, evolved, pacts } = g.growth;
    this.charges.killed();
    this.pacts.heat();
    this.charges.heat(attack);
    const generation = attack.source === 'fission' ? (attack.generation ?? 0) : 0,
      depth = values.fission.depth + (pacts.greed ? g.rules.pacts.greed.depth : 0);
    if (ranks.fission && generation < depth) {
      const child = { ...this.begin('fission', values.fission.damage), generation, depth: 2 };
      this.schedule(g.rules.skills.fission.delaySeconds, () => this.split(child, point));
    }
    if (attack.source === 'field' && !attack.spent && evolved.field)
      this.timed.leaveRemnant(attack, point);
  }

  effect(
    attack: Attack,
    kind: Effect['kind'],
    from: Point,
    to: Point,
    style: Style = {},
    targetId?: number,
  ): void {
    const { ranks, rarities } = this.game.growth,
      { radius = 0, life = 0.14, anchored = false, source = attack.source, width = 1.8 } = style;
    this.game.addEffect({
      kind,
      from,
      to,
      radius,
      width,
      life,
      damage: ['bolt', 'strike', 'pierce', 'return'].includes(kind) ? attack.damage : 0,
      source,
      rarity: (source && rarities[source]) || 'common',
      rank: source ? ranks[source] : 0,
      anchor: typeof anchored === 'number' ? anchored : anchored ? 'electron' : undefined,
      endAnchor: kind === 'return' ? (attack.satellite ?? 'electron') : undefined,
      targetId,
    });
  }

  // Marks a skill as having just fired, for the loadout and the log.
  activate(id: SkillId): void {
    const g = this.game,
      rank = g.growth.ranks[id];
    if (!rank) return;
    this.fired[id] = g.time;
    if (linkedSkills.includes(id))
      this.nextLinked[id] = g.tick + this.attackInterval * g.rules.time.tickRate;
    g.log('skill-effect', { id, rank });
  }
}
