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
  private surgeCharge = 0;
  private storedCharge = 0;
  private lastSurgeCharge = -Infinity;
  private nextSurgeHit = 0;
  private surgeUntil = 0;
  private nextSurge = 0;
  private surgeAttack?: Attack;

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
      if (this.fireSkill(id) && id !== 'focus')
        this.nextSkill[id] =
          g.tick +
          (g.rules.skills[id].periodSeconds / (id === 'vent' ? 1 : g.rate)) * g.rules.tickRate;
    }
    this.updateFocus();
    this.updateBarriers();
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
    if (id === 'burst') return { mode: 'conditional', progress: 0, active: false, fired };
    const timed = timedSkills.includes(id as TimedSkill),
      skill = id as TimedSkill;
    const interval =
      (timed
        ? g.rules.skills[skill].periodSeconds / (id === 'vent' ? 1 : g.rate)
        : g.attackInterval) * g.rules.tickRate;
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
    this.surgeCharge = 0;
    this.storedCharge = 0;
    this.surgeUntil = 0;
    this.surgeAttack = undefined;
    for (const target of this.game.targets) {
      target.bridgeUntil = 0;
      target.bridgeReady = 0;
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
    return this.game.time < (target.bridgeUntil ?? 0)
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
    this.volley(attack, origin, selected, true);
    return selected.length > 0;
  }

  resonate(): void {
    const g = this.game,
      attack = this.begin(undefined, g.rules.resonanceDamage);
    attack.power *= g.rules.resonanceDamage;
    this.volley(
      attack,
      g.position,
      closest(g.targets, g.position, attack.forms.multi.count, attack.range),
      true,
    );
  }

  fireSkill(id: TimedSkill, origin: Point = this.game.position): boolean {
    const g = this.game;
    if (!g.ranks[id]) return false;
    if (id === 'vent') {
      const removed = Math.min(g.mass, g.forms.vent.mass);
      if (!removed) return false;
      g.mass -= removed;
      g.log('vent', { removed, mass: g.mass });
      this.activate(id);
      this.effect(this.begin(id), 'vent', CENTER, CENTER, g.core + 8, 0.65, false, id);
      return true;
    }
    if (!g.targets.length) return false;
    const attack = this.begin(id),
      s = attack.forms;
    const multiplier =
      id === 'strike'
        ? s.strike.damage
        : id === 'focus'
          ? s.focus.damage
          : id === 'satellite'
            ? s.satellite.damage
            : id === 'bridge'
              ? s.bridge.damage
              : id === 'chase'
                ? s.chase.damage
                : id === 'gather'
                  ? s.gather.damage
                  : g.rules.skills[id].damage;
    attack.damage *= multiplier;
    const branches = s.multi.count;
    const within = (range: number) =>
      g.targets.filter((t) => t.hp > 0 && distance(t, origin) <= range);
    if (id === 'focus') {
      if (this.focus.length || !within(s.focus.range).length) return false;
      for (let i = 0; i < branches; i++)
        this.focus.push({
          attack: i ? { ...attack, damage: attack.damage * s.multi.damage } : attack,
          until: g.time + s.focus.duration,
          next: g.tick,
          held: 0,
          group: attack.id,
          started: false,
        });
      return true;
    }
    if (id === 'satellite') {
      let fired = 0;
      const reserved = new Set<number>();
      for (const [index, point] of this.satellitePoints.entries()) {
        const targets = closest(g.targets, point, g.targets.length, s.satellite.range)
          .sort((a, b) => Number(reserved.has(a.id)) - Number(reserved.has(b.id)))
          .slice(0, branches);
        targets.forEach((target) => reserved.add(target.id));
        fired += this.volley(
          { ...attack, satellite: index, range: s.satellite.range },
          point,
          targets,
          index,
        );
      }
      if (fired) this.activate(id);
      return fired > 0;
    }
    if (id === 'bridge') {
      if (this.barriers.length >= g.rules.skills.bridge.maxArcs) return false;
      this.barriers.push({
        id: this.order++,
        attack: { ...attack, depth: 1 },
        start: g.angle,
        sweep: 0,
        until: g.time + s.bridge.duration,
        drawn: -Infinity,
      });
      this.activate(id);
      return true;
    }
    if (id === 'gather') {
      const anchors = closest(
        g.targets.filter((t) => t.radius >= g.core + 45),
        origin,
        branches,
        g.range * 1.5,
      );
      const moved = new Set<number>();
      const reserved = new Set(anchors.map((target) => target.id));
      let fired = 0;
      for (const anchor of anchors) {
        const point = { ...anchor };
        fired += this.volley(attack, origin, [anchor], true);
        const group = closest(g.targets, point, s.gather.count, s.gather.radius);
        for (const target of group) {
          if (moved.has(target.id) || reserved.has(target.id) || g.time < (target.gatherReady ?? 0))
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
            { ...attack, damage: attack.damage * 0.5, depth: 1, firstKill: undefined },
            from,
            target,
            false,
          );
        }
      }
      if (fired > 1) this.activate('multi', attack.ranks.multi);
      if (anchors.length) this.activate(id);
      return anchors.length > 0;
    }
    const targets =
      id === 'strike'
        ? within(s.strike.range)
            .sort((a, b) => b.hp - a.hp || a.id - b.id)
            .slice(0, s.strike.count + branches - 1)
        : id === 'repel'
          ? within(s.repel.range)
              .sort((a, b) => a.radius - b.radius || a.id - b.id)
              .slice(0, s.repel.count + branches - 1)
          : within(g.range * 1.5)
              .filter((t) => t.hp / t.maxHp <= s.chase.threshold)
              .sort((a, b) => a.hp - b.hp || a.radius - b.radius || a.id - b.id)
              .slice(0, s.chase.count + branches - 1);
    attack.push = id === 'repel';
    if (id === 'chase') {
      const pursuit = {
        remaining: s.chase.jumps,
        visited: new Set<number>(),
        continued: new Set<number>(),
      };
      for (const [i, target] of targets.entries())
        this.pursue(
          i ? { ...attack, damage: attack.damage * s.multi.damage } : attack,
          origin,
          target,
          pursuit,
          true,
        );
    } else this.volley(attack, origin, targets, true);
    if (targets.length) this.activate(id);
    return targets.length > 0;
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
  ): void {
    if (target.hp <= 0 || pursuit.visited.has(target.id)) return;
    pursuit.visited.add(target.id);
    this.activate('chase', attack.ranks.chase);
    this.volley({ ...attack, pursuit }, origin, [target], anchored);
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

  private begin(source?: SkillId, multiplier = 1): Attack {
    const g = this.game,
      forms = g.forms;
    return {
      id: this.nextId++,
      ranks: { ...g.ranks },
      rarities: { ...g.rarities },
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
      rarity: source ? attack.rarities[source] : attack.rarities.power,
      rank: source ? attack.ranks[source] : 0,
      anchor: typeof anchored === 'number' ? anchored : anchored ? 'electron' : undefined,
      endAnchor: kind === 'return' ? (attack.satellite ?? 'electron') : undefined,
      targetId,
    });
  }

  private volley(attack: Attack, origin: Point, selected: Target[], anchored: Anchor): number {
    let fired = 0;
    for (const [i, target] of selected.entries()) {
      if (target.hp <= 0) continue;
      const branch =
        i && attack.ranks.multi
          ? { ...attack, damage: attack.damage * attack.forms.multi.damage, firstKill: undefined }
          : attack;
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
    return fired;
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
    }
    let previous: Point = contact;
    for (let hop = 0; hop < s.chain.hops; hop++) {
      const next = closest(this.game.targets, previous, 1, s.chain.range, visited)[0];
      if (!next) break;
      visited.add(next.id);
      const damage = attack.damage * this.game.rules.skills.chain.falloff ** (hop + 1);
      this.effect({ ...attack, damage }, 'bolt', previous, next, 0, 0.14, false, 'chain', 1.3);
      this.activate('chain', attack.ranks.chain);
      previous = { x: next.x, y: next.y };
      this.deal(attack, next, damage);
    }
    this.discharge(attack);
  }

  private deal(attack: Attack, target: Target, damage: number): void {
    if (target.hp <= 0) return;
    const g = this.game;
    g.damageTarget(target, damage, attack);
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
        const charged = {
          ...attack,
          source: 'charge' as const,
          pursuit: undefined,
          damage: attack.power * attack.forms.charge.damage,
          firstKill: undefined,
          depth: attack.depth + 1,
          push: false,
        };
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

  private push(target: Target, amount: number, immunity: number, radius = target.radius): void {
    const g = this.game;
    if (g.time < (target.pushReady ?? 0)) return;
    target.pushReady = g.time + immunity;
    target.controlCount = (target.controlCount ?? 0) + 1;
    target.radius = Math.max(
      target.radius,
      Math.min(g.rules.spawnRadius, radius + amount / (1 + 0.18 * (target.controlCount - 1))),
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
    const child = {
      ...attack,
      source: 'burst' as const,
      pursuit: undefined,
      damage: attack.power * attack.forms.burst.damage,
      firstKill: undefined,
      depth: attack.depth + 1,
      push: false,
    };
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
    let previous: Point = targets.at(-1) ?? from;
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
            this.nextSkill.focus =
              g.tick + (g.rules.skills.focus.periodSeconds / g.rate) * g.rules.tickRate;
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
        target.bridgeReady = g.time + cfg.immunitySeconds;
        target.bridgeUntil = g.time + cfg.slowSeconds;
        const contact = orbit(target.angle, g.radius);
        this.volley(barrier.attack, contact, [target], false);
        if (target.hp > 0)
          this.push(target, forms.push, cfg.immunitySeconds, Math.max(g.radius, target.radius));
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
