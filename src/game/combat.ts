import { timedSkills } from './skills.ts';
import type { SkillValues, TimedSkill } from './skills.ts';
import { CENTER, distance, norm, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { closest, onSegment } from './targeting.ts';
import type { Ranks, Rarities, SkillId, UpgradeId } from './rules.ts';
import type { Effect, SkillStatus, Target } from './types.ts';
import type { Game } from './model.ts';

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
};
type Pulse = {
  at: number;
  order: number;
  attack: Attack;
  target?: Target;
  from?: Point;
  reverse?: Point;
  returnTarget?: number;
  anchored: boolean;
};
type Focus = {
  attack: Attack;
  until: number;
  next: number;
  target?: Target;
  held: number;
  group: number;
};
type Orb = {
  id: number;
  attack: Attack;
  point: Point;
  velocity: Point;
  until: number;
  next: number;
  drawn: number;
};
type Bridge = {
  id: number;
  attack: Attack;
  from: Point;
  to: Point;
  until: number;
  drawn: number;
  hit: Set<number>;
};

export class Combat {
  private readonly game: Game;
  activations: Partial<Record<SkillId, number>> = {};
  private firedAt: Partial<Record<SkillId, number>> = {};
  private nextAttack: number;
  private nextId = 0;
  private order = 0;
  private nextSkill: Record<TimedSkill, number> = {
    strike: Infinity,
    repel: Infinity,
    focus: Infinity,
    orb: Infinity,
    gather: Infinity,
    chase: Infinity,
  };
  private pulses: Pulse[] = [];
  private focus: Focus[] = [];
  private orbs: Orb[] = [];
  private bridges: Bridge[] = [];
  private lastNode?: { point: Point; id: number; time: number };
  private nextBridge = 0;
  private surgeCharge = 0;
  private lastKill = -Infinity;
  private surgeUntil = 0;
  private nextSurge = 0;
  private surgeAttack?: Attack;

  constructor(game: Game) {
    this.game = game;
    this.nextAttack = game.rules.attackBaseSeconds * game.rules.tickRate;
  }

  update(): void {
    const g = this.game;
    const due = this.pulses
      .filter((p) => p.at <= g.tick + 1e-8)
      .sort((a, b) => a.at - b.at || a.order - b.order);
    this.pulses = this.pulses.filter((p) => p.at > g.tick + 1e-8);
    for (const pulse of due) {
      if (pulse.reverse) this.reverse(pulse.attack, pulse.reverse, pulse.returnTarget);
      else {
        const from = pulse.anchored ? g.position : pulse.from!;
        const target =
          pulse.target && pulse.target.hp > 0 && g.targets.includes(pulse.target)
            ? pulse.target
            : closest(g.targets, from, 1, pulse.attack.range)[0];
        if (target) {
          this.emit(pulse.attack, from, target, pulse.anchored, true);
          this.activate('repeat');
        }
      }
    }
    if (g.combatEnabled && g.tick + 1e-8 >= this.nextAttack) {
      this.fireBasic();
      this.nextAttack += g.attackInterval * g.rules.tickRate;
    }
    for (const id of timedSkills) {
      if (this.nextSkill[id] > g.tick + 1e-8) continue;
      if (id === 'focus' && this.focus.length) continue;
      if (id === 'orb' && this.orbs.length + g.forms.multi.count > g.rules.skills.orb.maxActive)
        continue;
      this.fireSkill(id);
      this.nextSkill[id] = g.tick + (g.rules.skills[id].periodSeconds / g.rate) * g.rules.tickRate;
    }
    this.updateFocus();
    this.updateOrbs();
    this.updateBridges();
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
            : g.time - this.lastKill > g.rules.skills.surge.windowSeconds
              ? 0
              : this.surgeCharge / g.forms.surge.kills,
        active: g.phase === 'running' && this.surgeUntil > g.time,
        fired,
      };
    if (id === 'charge')
      return {
        mode: 'charging',
        progress: Math.min(
          1,
          g.targets.reduce((max, t) => Math.max(max, t.charge ?? 0), 0) /
            (g.forms.charge.threshold || 1),
        ),
        active: false,
        fired,
      };
    if (id === 'burst' || id === 'stun')
      return { mode: 'conditional', progress: 0, active: false, fired };
    const timed = timedSkills.includes(id as TimedSkill),
      skill = id as TimedSkill;
    const interval =
      (timed
        ? g.rules.skills[skill].periodSeconds / g.rate
        : id === 'bridge'
          ? g.rules.skills.bridge.periodSeconds / g.rate
          : g.attackInterval) * g.rules.tickRate;
    const next = timed
      ? this.nextSkill[skill]
      : id === 'bridge'
        ? this.nextBridge
        : this.nextAttack;
    const active =
      g.phase === 'running' &&
      (id === 'focus'
        ? this.focus.length > 0
        : id === 'orb'
          ? this.orbs.length > 0
          : id === 'bridge'
            ? this.bridges.length > 0
            : false);
    return {
      mode: timed || id === 'bridge' ? 'timed' : 'linked',
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
    this.nextBridge = tick + Math.max(0, this.nextBridge - tick) * ratio;
    this.nextSurge = tick + Math.max(0, this.nextSurge - tick) * ratio;
    for (const id of timedSkills)
      if (Number.isFinite(this.nextSkill[id]))
        this.nextSkill[id] = tick + Math.max(0, this.nextSkill[id] - tick) * ratio;
  }

  clear(): void {
    this.pulses = [];
    this.focus = [];
    this.orbs = [];
    this.bridges = [];
    this.lastNode = undefined;
    this.surgeCharge = 0;
    this.surgeUntil = 0;
    this.surgeAttack = undefined;
    for (const target of this.game.targets) {
      target.charge = 0;
      target.stunUntil = 0;
    }
  }

  movementScale(target: Target): number {
    return this.game.time < (target.stunUntil ?? 0) ? 0 : 1;
  }

  killed(): void {
    const g = this.game;
    if (!g.ranks.surge || g.time < this.surgeUntil) return;
    if (g.time - this.lastKill > g.rules.skills.surge.windowSeconds) this.surgeCharge = 0;
    this.lastKill = g.time;
    this.surgeCharge++;
    if (this.surgeCharge < g.forms.surge.kills) return;
    this.surgeCharge = 0;
    this.surgeUntil = g.time + g.forms.surge.duration;
    this.nextSurge = g.tick + 1;
    this.surgeAttack = this.begin('surge', g.forms.surge.damage);
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

  fireBasic(origin: Point = this.game.position): void {
    const attack = this.begin();
    this.volley(
      attack,
      origin,
      closest(this.game.targets, origin, attack.forms.multi.count, attack.range),
      true,
    );
  }

  fireSkill(id: TimedSkill, origin: Point = this.game.position): void {
    const g = this.game;
    if (!g.ranks[id]) return;
    const s = g.forms;
    const multiplier =
      id === 'strike'
        ? s.strike.damage
        : id === 'focus'
          ? s.focus.damage
          : id === 'orb'
            ? s.orb.damage
            : id === 'chase'
              ? s.chase.damage
              : g.rules.skills[id].damage;
    const attack = this.begin(id, multiplier),
      branches = s.multi.count;
    const within = (range: number) =>
      g.targets.filter((t) => t.hp > 0 && distance(t, origin) <= range);
    if (id === 'focus') {
      if (this.focus.length) return;
      for (let i = 0; i < branches; i++)
        this.focus.push({
          attack: i ? { ...attack, damage: attack.damage * s.multi.damage } : attack,
          until: g.time + s.focus.duration,
          next: g.tick,
          held: 0,
          group: attack.id,
        });
      return;
    }
    if (id === 'orb') {
      const selected = closest(g.targets, origin, branches, g.range * 1.5);
      if (!selected.length || this.orbs.length + selected.length > g.rules.skills.orb.maxActive)
        return;
      for (const [i, target] of selected.entries())
        this.orbs.push({
          id: this.order++,
          attack: i ? { ...attack, damage: attack.damage * s.multi.damage } : attack,
          point: { ...origin },
          velocity: norm({ x: target.x - origin.x, y: target.y - origin.y }),
          until: g.time + s.orb.duration,
          next: g.tick,
          drawn: -Infinity,
        });
      this.activate(id);
      if (selected.length > 1) this.activate('multi');
      return;
    }
    if (id === 'gather') {
      const anchors = closest(
        g.targets.filter((t) => t.radius >= g.core + 45),
        origin,
        branches,
        g.range * 1.5,
      );
      const moved = new Set<number>();
      for (const anchor of anchors) {
        const point = { ...anchor };
        this.volley(attack, origin, [anchor], true);
        const group = closest(g.targets, point, s.gather.count, s.gather.radius);
        for (const target of group) {
          if (moved.has(target.id) || target === anchor || g.time < (target.gatherReady ?? 0))
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
          this.effect(attack, 'bolt', from, target, 0, 0.22);
        }
      }
      if (anchors.length) this.activate(id);
      return;
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
    this.volley(attack, origin, targets, true);
    if (targets.length) this.activate(id);
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
    anchored = false,
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
      life,
      source,
      rarity: source ? attack.rarities[source] : attack.rarities.power,
      rank: source ? attack.ranks[source] : 0,
      anchor: anchored ? 'electron' : undefined,
      targetId,
    });
  }

  private volley(attack: Attack, origin: Point, selected: Target[], anchored: boolean): void {
    if (selected.length > 1 && attack.ranks.multi) this.activate('multi');
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
    }
  }

  private emit(
    attack: Attack,
    origin: Point,
    target: Target,
    anchored: boolean,
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
      anchored && kind !== 'strike',
      source,
      kind === 'focus' ? 1.5 + Math.max(0, attack.damage / attack.power - 0.65) : 1.8,
      target.id,
    );
    const point = { x: target.x, y: target.y };
    this.resolve(attack, target, origin, anchored);
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
        returnTarget: target.id,
        anchored: false,
      });
  }

  private resolve(
    attack: Attack,
    primary: Target,
    origin: Point,
    anchored = false,
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
      this.effect(attack, 'pierce', origin, to, 0, 0.14, anchored, 'pierce', s.pierce.width);
      this.activate('pierce', attack.ranks.pierce);
      for (const target of onSegment(this.game.targets, origin, to, s.pierce.width)) {
        if (visited.has(target.id)) continue;
        visited.add(target.id);
        this.deal(attack, target, attack.damage * this.game.rules.skills.pierce.damage);
      }
    }
    let previous: Point = contact;
    for (let hop = 0; hop < s.chain.hops; hop++) {
      const next = closest(this.game.targets, previous, 1, s.chain.range, visited)[0];
      if (!next) break;
      visited.add(next.id);
      this.effect(attack, 'bolt', previous, next, 0, 0.14, false, 'chain', 1.3);
      this.activate('chain', attack.ranks.chain);
      previous = { x: next.x, y: next.y };
      this.deal(attack, next, attack.damage * this.game.rules.skills.chain.falloff ** (hop + 1));
    }
    this.discharge(attack);
  }

  private deal(attack: Attack, target: Target, damage: number): void {
    if (target.hp <= 0) return;
    const g = this.game;
    g.damageTarget(target, damage, attack);
    if (attack.ranks.bridge && attack.depth === 0) this.connect(attack, target);
    if (target.hp <= 0) return;
    if (attack.push && g.time >= (target.pushReady ?? 0)) {
      target.pushReady = g.time + g.rules.skills.repel.immunitySeconds;
      target.controlCount = (target.controlCount ?? 0) + 1;
      target.radius = Math.min(
        g.rules.spawnRadius,
        target.radius + attack.forms.repel.push / (1 + 0.18 * (target.controlCount - 1)),
      );
      Object.assign(target, orbit(target.angle, target.radius));
    }
    if (attack.ranks.stun && g.time >= (target.stunReady ?? 0)) {
      target.controlCount = (target.controlCount ?? 0) + 1;
      const duration = attack.forms.stun.duration / (1 + 0.18 * (target.controlCount - 1));
      target.stunUntil = g.time + duration;
      target.stunReady = target.stunUntil + g.rules.skills.stun.immunitySeconds;
      this.effect(attack, 'stun', target, target, target.size + 3, duration, false, 'stun');
      this.activate('stun', attack.ranks.stun);
    }
    if (attack.ranks.charge && attack.source !== 'charge' && attack.depth < 2) {
      target.charge = (target.charge ?? 0) + Math.min(1, damage / attack.power);
      if (target.charge + 1e-8 >= attack.forms.charge.threshold) {
        target.charge = 0;
        const charged = {
          ...attack,
          source: 'charge' as const,
          damage: attack.power * attack.forms.charge.damage,
          firstKill: undefined,
          depth: attack.depth + 1,
          push: false,
        };
        this.effect(charged, 'bolt', g.position, target, 0, 0.2, true, 'charge', 4);
        this.activate('charge', attack.ranks.charge);
        this.resolve(charged, target, g.position, true);
      } else
        this.effect(
          attack,
          'charge',
          target,
          target,
          target.size + 2,
          0.3,
          false,
          'charge',
          target.charge / attack.forms.charge.threshold,
          target.id,
        );
    }
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
      damage: attack.power * attack.forms.burst.damage,
      firstKill: undefined,
      depth: attack.depth + 1,
      push: false,
    };
    if (targets.length) this.activate('burst', attack.ranks.burst);
    this.volley(child, from, targets, false);
  }

  private reverse(attack: Attack, from: Point, originTarget?: number): void {
    const to = this.game.position,
      targets = onSegment(this.game.targets, from, to, this.game.rules.skills.return.width).filter(
        (t) => t.id !== originTarget || distance(t, from) > 4,
      ),
      target = targets[0];
    this.effect(attack, 'return', from, to, 0, 0.2, false, 'return');
    this.activate('return', attack.ranks.return);
    if (target) this.resolve(attack, target, from, false, to);
  }

  private connect(attack: Attack, target: Target): void {
    const g = this.game,
      previous = this.lastNode;
    this.lastNode = { point: { x: target.x, y: target.y }, id: target.id, time: g.time };
    if (
      !previous ||
      previous.id === target.id ||
      g.time - previous.time > 2 ||
      g.tick < this.nextBridge
    )
      return;
    const length = distance(previous.point, target);
    if (length < 12 || length > attack.forms.bridge.length) return;
    const cast: Bridge = {
      id: this.order++,
      attack: {
        ...attack,
        id: this.nextId++,
        source: 'bridge',
        damage: attack.power * attack.forms.bridge.damage,
        depth: 1,
        firstKill: undefined,
        budget: { burst: false },
        push: false,
      },
      from: previous.point,
      to: { x: target.x, y: target.y },
      until: g.time + attack.forms.bridge.duration,
      drawn: -Infinity,
      hit: new Set(),
    };
    this.bridges.push(cast);
    if (this.bridges.length > attack.forms.bridge.count) this.bridges.shift();
    this.nextBridge = g.tick + (g.rules.skills.bridge.periodSeconds / g.rate) * g.rules.tickRate;
    this.activate('bridge', attack.ranks.bridge);
  }

  private updateFocus(): void {
    const g = this.game;
    this.focus = this.focus.filter((c) => g.time < c.until - 1e-8);
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
        const attack = {
          ...cast.attack,
          damage: cast.attack.damage * (1 + cast.held * g.rules.skills.focus.ramp),
          firstKill: undefined,
        };
        this.volley(attack, g.position, [cast.target], true);
        this.activate('focus', attack.ranks.focus);
        cast.held += g.rules.skills.focus.tickSeconds;
      }
      cast.next += g.rules.skills.focus.tickSeconds * g.rules.tickRate;
    }
  }

  private updateOrbs(): void {
    const g = this.game,
      cfg = g.rules.skills.orb;
    this.orbs = this.orbs.filter(
      (c) =>
        g.time < c.until - 1e-8 &&
        c.point.x > -30 &&
        c.point.x < 390 &&
        c.point.y > 60 &&
        c.point.y < 460,
    );
    for (const orb of this.orbs) {
      orb.point.x += (orb.velocity.x * cfg.speed) / g.rules.tickRate;
      orb.point.y += (orb.velocity.y * cfg.speed) / g.rules.tickRate;
      if (g.time - orb.drawn >= 0.08) {
        this.effect(orb.attack, 'orb', orb.point, orb.point, 4, 0.12, false, 'orb', 1, orb.id);
        orb.drawn = g.time;
      }
      if (g.tick < orb.next - 1e-8) continue;
      this.volley(
        orb.attack,
        orb.point,
        closest(g.targets, orb.point, 1, orb.attack.forms.orb.radius),
        false,
      );
      orb.next += cfg.tickSeconds * g.rules.tickRate;
    }
  }

  private updateBridges(): void {
    const g = this.game;
    this.bridges = this.bridges.filter((c) => g.time < c.until - 1e-8);
    for (const bridge of this.bridges) {
      if (g.time - bridge.drawn >= 0.1) {
        this.effect(
          bridge.attack,
          'bridge',
          bridge.from,
          bridge.to,
          0,
          0.15,
          false,
          'bridge',
          1,
          bridge.id,
        );
        bridge.drawn = g.time;
      }
      for (const target of onSegment(
        g.targets,
        bridge.from,
        bridge.to,
        g.rules.skills.bridge.width,
      )) {
        if (bridge.hit.has(target.id)) continue;
        bridge.hit.add(target.id);
        this.volley(bridge.attack, bridge.from, [target], false);
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
    this.game.log('skill-effect', { id, rank });
  }
}
