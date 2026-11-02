import { timedSkills } from './skills.ts';
import type { SkillValues, TimedSkill } from './skills.ts';
import { CENTER, distance, norm, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { closest, onSegment } from './targeting.ts';
import type { Ranks, Rarities, SkillId, UpgradeId } from './rules.ts';
import type { Effect, SkillStatus, Target } from './types.ts';
import type { Game } from './Game.ts';

type Pursuit = { remaining: number; visited: Set<number>; continued: Set<number> };
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
  push?: boolean;
  satellite?: number;
  pursuit?: Pursuit;
};
type Pulse = {
  at: number;
  order: number;
  attack: Attack;
  target?: Target;
  from?: Point;
  reverse?: Point;
  pursuit?: Pursuit;
  // A delayed single hit that lets a group of particles pop one after another.
  pop?: boolean;
  anchored: Anchor;
};
type Focus = {
  attack: Attack;
  until: number;
  next: number;
  target?: Target;
  held: number;
  group: number;
  started: boolean;
};
type Trail = {
  attack: Attack;
  from: Point;
  to: Point;
  width: number;
  until: number;
  next: number;
};
type Barrier = {
  id: number;
  attack: Attack;
  start: number;
  sweep: number;
  until: number;
  drawn: number;
};

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
    repel: Infinity,
    focus: Infinity,
    satellite: Infinity,
    bridge: Infinity,
    vent: Infinity,
    gather: Infinity,
    chase: Infinity,
  };
  private pulses: Pulse[] = [];
  private focus: Focus[] = [];
  private barriers: Barrier[] = [];
  private trails: Trail[] = [];
  private surgeCharge = 0;
  private storedCharge = 0;
  private lastSurgeCharge = -Infinity;
  private nextSurgeHit = 0;
  private surgeUntil = 0;
  private nextSurge = 0;
  private surgeAttack?: Attack;
  private marked = new Set<number>();

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

  update(): void {
    const g = this.game;
    const due = this.pulses
      .filter((p) => p.at <= g.tick + 1e-8)
      .sort((a, b) => a.at - b.at || a.order - b.order);
    this.pulses = this.pulses.filter((p) => p.at > g.tick + 1e-8);
    for (const pulse of due) {
      if (pulse.pursuit) {
        const target = this.wounded(pulse.attack, pulse.from!, pulse.pursuit.visited)[0];
        if (target) this.pursue(pulse.attack, pulse.from!, target, pulse.pursuit);
      } else if (pulse.reverse) this.reverse(pulse.attack, pulse.reverse);
      else if (pulse.pop) this.pop(pulse);
      else {
        const from =
          typeof pulse.anchored === 'number'
            ? (this.satellitePoints[pulse.anchored] ?? pulse.from!)
            : pulse.anchored
              ? g.position
              : pulse.from!;
        const target =
          pulse.target && pulse.target.hp > 0 && g.targets.includes(pulse.target)
            ? pulse.target
            : pulse.attack.pursuit
              ? this.wounded(pulse.attack, from, pulse.attack.pursuit.visited)[0]
              : closest(g.targets, from, 1, pulse.attack.range)[0];
        if (target) {
          this.emit(pulse.attack, from, target, pulse.anchored, true);
          this.activate('repeat');
        }
      }
    }
    if (g.combatEnabled && g.tick + 1e-8 >= this.nextAttack) {
      if (this.fireBasic()) {
        // Preserve fractional cadence during regular fire; an idle-ready attack
        // starts a new interval rather than accumulating overdue shots.
        const at = g.tick - this.nextAttack < 1 + 1e-8 ? this.nextAttack : g.tick;
        this.nextAttack = at + g.attackInterval * g.rules.tickRate;
      }
    }
    for (const id of timedSkills) {
      if (this.nextSkill[id] > g.tick + 1e-8) continue;
      if (id === 'focus' && this.focus.length) continue;
      if (this.fireSkill(id) && id !== 'focus') this.nextSkill[id] = g.tick + this.interval(id);
    }
    this.updateFocus();
    this.updateBarriers();
    this.updateTrails();
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
    if (id === 'burst' || id === 'tempo')
      return { mode: 'conditional', progress: 0, active: false, fired };
    const timed = timedSkills.includes(id as TimedSkill),
      skill = id as TimedSkill;
    const interval = timed ? this.interval(skill) : g.attackInterval * g.rules.tickRate;
    const next = timed ? this.nextSkill[skill] : (this.nextLinked[id] ?? g.tick);
    const active =
      g.phase === 'running' &&
      (id === 'focus' ? this.focus.length > 0 : id === 'bridge' ? this.barriers.length > 0 : false);
    return {
      mode: timed ? 'timed' : 'linked',
      progress: Math.max(0, Math.min(1, 1 - (next - g.tick) / interval)),
      active,
      fired,
    };
  }

  learn(id: UpgradeId, previous: number): void {
    if (id in this.nextSkill && previous === 0)
      this.nextSkill[id as TimedSkill] = this.game.tick + 1;
  }

  private interval(id: TimedSkill): number {
    const g = this.game;
    return (g.rules.skills[id].periodSeconds / (id === 'vent' ? 1 : g.rate)) * g.rules.tickRate;
  }

  rescaleCooldowns(oldRate: number): void {
    const { tick, rate } = this.game,
      ratio = oldRate / rate;
    this.nextAttack = tick + Math.max(0, this.nextAttack - tick) * ratio;
    this.nextSurge = tick + Math.max(0, this.nextSurge - tick) * ratio;
    for (const id of Object.keys(this.nextLinked) as SkillId[])
      this.nextLinked[id] = tick + Math.max(0, this.nextLinked[id]! - tick) * ratio;
    for (const id of timedSkills)
      if (id !== 'vent' && Number.isFinite(this.nextSkill[id]))
        this.nextSkill[id] = tick + Math.max(0, this.nextSkill[id] - tick) * ratio;
  }

  clear(): void {
    this.pulses = [];
    this.focus = [];
    this.barriers = [];
    this.trails = [];
    this.surgeCharge = 0;
    this.storedCharge = 0;
    this.surgeUntil = 0;
    this.surgeAttack = undefined;
    this.marked.clear();
    for (const target of this.game.targets) {
      target.bridgeUntil = 0;
      target.bridgeReady = 0;
      target.marked = false;
    }
  }

  reset(): void {
    this.clear();
    this.firedAt = {};
    this.nextLinked = {};
    this.lastSurgeCharge = -Infinity;
    this.nextSurgeHit = 0;
    this.nextAttack = this.nextSurge = this.game.tick + 1;
    for (const id of timedSkills)
      this.nextSkill[id] = this.game.ranks[id] ? this.game.tick + 1 : Infinity;
  }

  movementScale(target: Target): number {
    return target.kind !== 'boss' && this.game.time < (target.bridgeUntil ?? 0)
      ? this.game.rules.skills.bridge.movementScale
      : 1;
  }

  killed(): void {
    this.chargeSurge(1);
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

  fireBasic(origin: Point = this.game.position): boolean {
    const range = this.game.range;
    if (!this.game.targets.some((t) => t.hp > 0 && distance(t, origin) <= range)) return false;
    const attack = this.begin();
    const selected = closest(this.game.targets, origin, attack.forms.multi.count, attack.range);
    // Basic fire always answers the boss, so builds without single-target skills can still fight it.
    const boss = this.game.boss;
    if (boss && !selected.includes(boss) && distance(boss, origin) <= attack.range) {
      selected.unshift(boss);
      selected.length = attack.forms.multi.count;
    }
    this.volley(attack, origin, selected, true);
    return selected.length > 0;
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
    attack.push = false;
    for (const target of [...g.targets]) this.deal(attack, target, attack.damage);
  }

  // Tempo: each accepted beat sweeps forward along the orbit, popping particles inside it in order.
  sweep(beat: 1 | 2 | 3): void {
    const g = this.game;
    if (!g.ranks.tempo) return;
    const s = g.forms.tempo,
      count = s.count * (beat === 3 ? g.rules.skills.tempo.finishScale : 1);
    const ahead = (t: Target) =>
      (((t.angle - g.angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const targets = g.targets
      .filter((t) => t.hp > 0 && t.radius <= g.radius + s.band)
      .sort((a, b) => ahead(a) - ahead(b) || a.id - b.id)
      .slice(0, count);
    if (!targets.length) return;
    const attack = { ...this.begin('tempo', s.damage), depth: 2 };
    this.popInOrder(attack, g.position, targets, g.rules.skills.tempo.popSeconds);
    this.activate('tempo');
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
        undefined,
        1.3,
        target.id,
      );
    this.deal(pulse.attack, target, pulse.attack.damage);
  }

  fireSkill(id: TimedSkill, origin: Point = this.game.position): boolean {
    const g = this.game;
    if (!g.ranks[id]) return false;
    if (id === 'vent') return this.fireVent();
    if (!g.targets.length) return false;
    const attack = this.begin(id),
      s = attack.forms;
    attack.damage *= id === 'repel' ? g.rules.skills.repel.damage : s[id].damage;
    if (id === 'focus') return this.fireFocus(attack, origin);
    if (id === 'satellite') return this.fireSatellite(attack);
    if (id === 'bridge') return this.fireBridge(attack);
    if (id === 'gather') return this.fireGather(attack, origin);
    const branches = s.multi.count;
    const targets =
      id === 'strike'
        ? this.within(origin, s.strike.range)
            .sort((a, b) => b.maxHp - a.maxHp || a.hp - b.hp || a.radius - b.radius || a.id - b.id)
            .slice(0, s.strike.count + branches - 1)
        : id === 'repel'
          ? this.within(origin, s.repel.range)
              .sort((a, b) => a.radius - b.radius || a.id - b.id)
              .slice(0, s.repel.count + branches - 1)
          : this.wounded(attack, origin, new Set()).slice(0, s.chase.count + branches - 1);
    attack.push = id === 'repel';
    if (id === 'chase') {
      const pursuit = {
        remaining: s.chase.jumps,
        visited: new Set<number>(),
        continued: new Set<number>(),
      };
      let fired = 0;
      for (const [i, target] of targets.entries())
        fired += this.pursue(this.branch(attack, i), origin, target, pursuit, true);
      if (fired > 1) this.activate('multi', attack.ranks.multi);
    } else this.volley(attack, origin, targets, true);
    if (targets.length) this.activate(id);
    return targets.length > 0;
  }

  private within(origin: Point, range: number): Target[] {
    return this.game.targets.filter((t) => t.hp > 0 && distance(t, origin) <= range);
  }

  private fireVent(): boolean {
    const g = this.game,
      s = g.forms.vent,
      cfg = g.rules.skills.vent;
    const targets = g.targets
      .filter((t) => t.hp > 0 && distance(t, CENTER) <= s.radius)
      .sort((a, b) => a.radius - b.radius || a.id - b.id);
    const removed = g.releaseMass(s.mass);
    if (!removed && !targets.length) return false;
    g.log('vent', { removed, mass: g.mass });
    this.activate('vent');
    const attack = { ...this.begin('vent', s.damage), depth: 2 };
    // The shockwave leaves the core and pops each particle as it reaches it.
    for (const target of targets)
      this.pulses.push({
        at: g.tick + (Math.max(0, target.radius - g.core) / cfg.waveSpeed) * g.rules.tickRate,
        order: this.order++,
        attack,
        target,
        anchored: false,
        pop: true,
      });
    this.effect(
      attack,
      'vent',
      CENTER,
      CENTER,
      s.radius,
      Math.max(0, s.radius - g.core) / cfg.waveSpeed + 0.15,
      false,
      'vent',
      g.core,
    );
    return true;
  }

  private fireFocus(attack: Attack, origin: Point): boolean {
    const g = this.game,
      s = attack.forms;
    if (this.focus.length || !this.within(origin, s.focus.range).length) return false;
    for (let i = 0; i < s.multi.count; i++)
      this.focus.push({
        attack: this.branch(attack, i),
        until: g.time + s.focus.duration,
        next: g.tick,
        held: 0,
        group: attack.id,
        started: false,
      });
    return true;
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

  private fireBridge(attack: Attack): boolean {
    const g = this.game;
    if (this.barriers.length >= g.rules.skills.bridge.maxArcs) return false;
    this.barriers.push({
      id: this.order++,
      attack: { ...attack, depth: 1 },
      start: g.angle,
      sweep: 0,
      until: g.time + attack.forms.bridge.duration,
      drawn: -Infinity,
    });
    this.activate('bridge');
    return true;
  }

  private fireGather(attack: Attack, origin: Point): boolean {
    const g = this.game,
      s = attack.forms;
    const anchors = closest(
      g.targets.filter((t) => t.radius >= g.core + 45),
      origin,
      s.multi.count,
      g.range * 1.5,
    );
    const moved = new Set<number>();
    const reserved = new Set(anchors.map((target) => target.id));
    let fired = 0;
    for (const [i, anchor] of anchors.entries()) {
      const branch = this.branch(attack, i);
      const point = { ...anchor };
      fired += this.volley(branch, origin, [anchor], true);
      const group = closest(g.targets, point, s.gather.count, s.gather.radius);
      for (const target of group) {
        if (
          target.kind === 'boss' ||
          moved.has(target.id) ||
          reserved.has(target.id) ||
          g.time < (target.gatherReady ?? 0)
        )
          continue;
        moved.add(target.id);
        target.gatherReady = g.time + g.rules.skills.gather.immunitySeconds;
        const from = { ...target },
          d = distance(point, target),
          amount = Math.min(0.65, s.gather.pull / Math.max(1, d));
        const x = target.x + (point.x - target.x) * amount,
          y = target.y + (point.y - target.y) * amount;
        target.angle = Math.atan2(y - CENTER.y, x - CENTER.x);
        target.radius = Math.max(target.radius, Math.hypot(x - CENTER.x, y - CENTER.y));
        Object.assign(target, orbit(target.angle, target.radius));
        this.emit(
          { ...branch, damage: branch.damage * 0.5, depth: 1, firstKill: undefined },
          from,
          target,
          false,
        );
      }
    }
    if (fired > 1) this.activate('multi', attack.ranks.multi);
    if (anchors.length) this.activate('gather');
    return anchors.length > 0;
  }

  private wounded(attack: Attack, origin: Point, visited: Set<number>): Target[] {
    return this.game.targets
      .filter(
        (t) =>
          t.hp > 0 &&
          !visited.has(t.id) &&
          t.hp / t.maxHp <= attack.forms.chase.threshold &&
          distance(t, origin) <= attack.range * 1.5,
      )
      .sort((a, b) => a.hp - b.hp || a.radius - b.radius || a.id - b.id);
  }

  private pursue(
    attack: Attack,
    origin: Point,
    target: Target,
    pursuit: Pursuit,
    anchored: Anchor = false,
  ): number {
    if (target.hp <= 0 || pursuit.visited.has(target.id)) return 0;
    pursuit.visited.add(target.id);
    this.activate('chase', attack.ranks.chase);
    return this.volley({ ...attack, pursuit }, origin, [target], anchored);
  }

  private continuePursuit(attack: Attack, target: Target): void {
    const pursuit = attack.pursuit;
    if (
      attack.source !== 'chase' ||
      !pursuit ||
      target.hp > 0 ||
      pursuit.remaining <= 0 ||
      pursuit.continued.has(target.id)
    )
      return;
    pursuit.continued.add(target.id);
    pursuit.visited.add(target.id);
    pursuit.remaining--;
    this.pulses.push({
      at: this.game.tick + this.game.rules.skills.chase.jumpSeconds * this.game.rules.tickRate,
      order: this.order++,
      attack,
      from: { x: target.x, y: target.y },
      anchored: false,
      pursuit,
    });
  }

  private secondary(attack: Attack, source: SkillId, multiplier: number): Attack {
    return {
      ...attack,
      source,
      pursuit: undefined,
      damage: attack.power * multiplier,
      firstKill: undefined,
      depth: attack.depth + 1,
      push: false,
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
      damage: ['bolt', 'strike', 'focus', 'pierce', 'return'].includes(kind) ? attack.damage : 0,
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
      link = { ...attack, damage, depth: 2, firstKill: undefined, push: false };
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
      ring = { ...attack, damage, depth: 2, firstKill: undefined, push: false };
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
    const kind =
      attack.source === 'strike' && !repeated
        ? 'strike'
        : attack.source === 'focus'
          ? 'focus'
          : 'bolt';
    this.effect(
      attack,
      kind,
      kind === 'strike' ? { x: target.x, y: target.y - 130 } : origin,
      target,
      0,
      kind === 'focus' ? 0.2 : 0.14,
      kind === 'strike' ? false : anchored,
      source,
      kind === 'focus' ? 1.5 + Math.max(0, attack.damage / attack.power - 0.65) : 1.8,
      target.id,
    );
    const point = { x: target.x, y: target.y };
    this.resolve(attack, target, origin, anchored);
    this.continuePursuit(attack, target);
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
          push: false,
        },
        reverse: point,
        anchored: false,
      });
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
            push: false,
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

  private deal(attack: Attack, target: Target, damage: number): void {
    if (target.hp <= 0) return;
    const g = this.game;
    g.damageTarget(target, damage, attack);
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
    if (target.hp <= 0) return;
    if (attack.push)
      this.push(target, attack.forms.repel.push, g.rules.skills.repel.immunitySeconds);
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
  }

  private push(target: Target, amount: number, immunity: number): void {
    const g = this.game;
    if (g.time < (target.pushReady ?? 0)) return;
    target.pushReady = g.time + immunity;
    target.controlCount = (target.controlCount ?? 0) + 1;
    if (target.kind === 'boss') amount *= g.rules.boss.pushScale;
    target.radius = Math.max(
      target.radius,
      Math.min(
        g.rules.spawnRadius,
        target.radius + amount / (1 + 0.18 * (target.controlCount - 1)),
      ),
    );
    Object.assign(target, orbit(target.angle, target.radius));
  }

  private discharge(attack: Attack): void {
    if (!attack.firstKill || !attack.ranks.burst || attack.budget.burst || attack.depth >= 2)
      return;
    attack.budget.burst = true;
    const from = attack.firstKill,
      targets = closest(
        this.game.targets,
        from,
        attack.forms.burst.count + attack.forms.multi.count - 1,
        attack.forms.burst.radius,
      );
    const child = this.secondary(attack, 'burst', attack.forms.burst.damage);
    if (targets.length) this.activate('burst', attack.ranks.burst);
    this.volley(child, from, targets, false);
  }

  private reverse(attack: Attack, from: Point): void {
    const to =
      attack.satellite === undefined
        ? this.game.position
        : (this.satellitePoints[attack.satellite] ?? this.game.position);
    const targets = onSegment(this.game.targets, from, to, attack.forms.return.width);
    this.effect(attack, 'return', from, to, 0, 0.2, false, 'return');
    this.activate('return', attack.ranks.return);
    // One shared visit set keeps the swept path and its chain branches from doubling hits.
    const visited = new Set(targets.map((t) => t.id));
    for (const target of targets) this.deal(attack, target, attack.damage);
    this.chain(attack, targets.at(-1) ?? from, visited);
    this.discharge(attack);
  }

  private updateFocus(): void {
    const g = this.game;
    this.focus = this.focus.filter((c) => g.time < c.until - 1e-8);
    const branches = new Map<number, number>();
    for (const cast of this.focus) {
      if (g.tick < cast.next - 1e-8) continue;
      if (
        !cast.target ||
        cast.target.hp <= 0 ||
        !g.targets.includes(cast.target) ||
        distance(cast.target, g.position) > cast.attack.forms.focus.range
      ) {
        const reserved = new Set(
          this.focus
            .filter((c) => c !== cast && c.group === cast.group)
            .flatMap((c) => (c.target ? [c.target.id] : [])),
        );
        cast.target = g.targets
          .filter(
            (t) =>
              t.hp > 0 &&
              !reserved.has(t.id) &&
              distance(t, g.position) <= cast.attack.forms.focus.range,
          )
          .sort((a, b) => a.radius - b.radius || a.id - b.id)[0];
        cast.held = 0;
      }
      if (cast.target) {
        if (!cast.started) {
          for (const sibling of this.focus)
            if (sibling.group === cast.group) sibling.started = true;
          if (Number.isFinite(this.nextSkill.focus))
            this.nextSkill.focus = g.tick + this.interval('focus');
        }
        const attack = {
          ...cast.attack,
          damage: cast.attack.damage * (1 + cast.held * g.rules.skills.focus.ramp),
          firstKill: undefined,
        };
        const fired = this.volley(attack, g.position, [cast.target], true);
        const count = (branches.get(cast.group) ?? 0) + fired;
        branches.set(cast.group, count);
        if (count === 2) this.activate('multi', attack.ranks.multi);
        this.activate('focus', attack.ranks.focus);
        cast.held += g.rules.skills.focus.tickSeconds;
      }
      cast.next += g.rules.skills.focus.tickSeconds * g.rules.tickRate;
    }
    // A later skill may have killed every reserved target in this same tick.
    // An empty reservation is not a channel and must remain ready to cast.
    this.focus = this.focus.filter((cast) => cast.started);
  }

  private updateBarriers(): void {
    const g = this.game,
      cfg = g.rules.skills.bridge;
    this.barriers = this.barriers.filter((c) => g.time < c.until - 1e-8);
    const ids = new Set(this.barriers.map((c) => c.id));
    g.effects = g.effects.filter((fx) => fx.kind !== 'bridge' || ids.has(fx.targetId!));
    for (const barrier of this.barriers) {
      const forms = barrier.attack.forms.bridge;
      barrier.sweep = Math.max(0, Math.min((forms.angle * Math.PI) / 180, g.angle - barrier.start));
      if (barrier.sweep <= 1e-8) continue;
      if (g.time - barrier.drawn >= 0.1) {
        g.addEffect({
          kind: 'bridge',
          source: 'bridge',
          targetId: barrier.id,
          from: orbit(barrier.start, g.radius),
          to: orbit(barrier.start + barrier.sweep, g.radius),
          radius: g.radius,
          width: forms.width,
          damage: barrier.attack.damage,
          life: Math.min(0.15, barrier.until - g.time),
          rank: barrier.attack.ranks.bridge,
          rarity: barrier.attack.rarities.bridge,
          arc: { start: barrier.start, sweep: barrier.sweep },
        });
        barrier.drawn = g.time;
      }
      const contacts = g.targets.filter((target) => {
        const angle =
          (((target.angle - barrier.start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const margin = forms.width / 2 + target.size / 2;
        const previous = target.previousRadius ?? target.radius;
        return (
          target.hp > 0 &&
          angle <= barrier.sweep + 1e-8 &&
          Math.min(previous, target.radius) <= g.radius + margin &&
          Math.max(previous, target.radius) >= g.radius - margin
        );
      });
      for (const target of contacts) {
        if (target.hp <= 0 || g.time < (target.bridgeReady ?? 0)) continue;
        // The net holds and slows particles, zapping them again while they stay inside.
        target.bridgeReady = g.time + cfg.zapSeconds;
        target.bridgeUntil = g.time + cfg.slowSeconds;
        const contact = orbit(target.angle, g.radius);
        this.volley(barrier.attack, contact, [target], false);
      }
    }
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
