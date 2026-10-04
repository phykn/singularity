import { distance, norm, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { higherRarity } from './rules.ts';
import type { FormValues, Ranks, Rarities, SkillId, UpgradeId } from './rules.ts';
import type { SkillStatus, Target } from './types.ts';
import type { Game } from './model.ts';
export type Attack = {
  id: number;
  ranks: Ranks;
  rarities: Rarities;
  forms: FormValues;
  damage: number;
  burstFired: boolean;
  firstKill?: Point;
  source?: TimedSkill;
  echo?: boolean;
  comboFired?: boolean;
};
type Pulse = { at: number; order: number; attack: Attack; target?: Target; skill?: TimedSkill };
type TimedSkill = 'strike' | 'wave' | 'whip' | 'focus';
type Sweep = {
  attack: Attack;
  from: Point;
  born: number;
  previous: number;
  hit: Set<number>;
  pushed: Set<number>;
  angle: number;
  modified: boolean;
};
type Focus = {
  attack: Attack;
  group: number;
  until: number;
  next: number;
  target?: Target;
  repeated: boolean;
};
function closest(
  targets: Target[],
  point: Point,
  count = 1,
  range = Infinity,
  visited?: Set<number>,
): Target[] {
  const nearest: { target: Target; distance: number }[] = [];
  for (const target of targets) {
    if (target.hp <= 0 || visited?.has(target.id)) continue;
    const dx = target.x - point.x,
      dy = target.y - point.y;
    if (Math.abs(dx) > range || Math.abs(dy) > range) continue;
    const d = Math.hypot(dx, dy);
    if (d > range) continue;
    let index = nearest.length;
    while (index > 0) {
      const previous = nearest[index - 1];
      if (d > previous.distance || (d === previous.distance && target.id >= previous.target.id))
        break;
      index--;
    }
    if (index >= count) continue;
    nearest.splice(index, 0, { target, distance: d });
    if (nearest.length > count) nearest.pop();
  }
  return nearest.map((entry) => entry.target);
}
export class Combat {
  private readonly game: Game;
  activations: Partial<Record<SkillId, number>> = {};
  private skillFiredAt: Partial<Record<SkillId, number>> = {};
  private nextAttack: number;
  private nextAttackId = 0;
  private nextFocusId = 0;
  private pulses: Pulse[] = [];
  private nextSkill: Record<TimedSkill, number> = {
    strike: Infinity,
    wave: Infinity,
    whip: Infinity,
    focus: Infinity,
  };
  private wave: Sweep[] = [];
  private whip: Sweep[] = [];
  private focus: Focus[] = [];
  constructor(game: Game) {
    this.game = game;
    this.nextAttack = game.rules.attackBaseSeconds * game.rules.tickRate;
  }

  update(): void {
    const game = this.game;
    const due = this.pulses
      .filter((p) => p.at <= game.tick + 1e-8)
      .sort((a, b) => a.attack.id - b.attack.id || a.order - b.order);
    this.pulses = this.pulses.filter((p) => p.at > game.tick + 1e-8);
    due.forEach((pulse) => {
      if (pulse.skill) {
        if (
          this.castSkill(pulse.skill, game.position, pulse.attack, true) &&
          pulse.skill !== 'focus'
        )
          this.activate('repeat', pulse.attack.ranks.repeat);
      } else this.hitPulse(pulse, game.position, true);
    });
    if (game.combatEnabled && game.tick + 1e-8 >= this.nextAttack) {
      this.fireBasic();
      this.nextAttack += game.attackInterval * game.rules.tickRate;
    }
    this.updateTimedSkills();
  }

  status(id: SkillId): SkillStatus {
    const fired =
      this.game.phase === 'running' && this.game.time - (this.skillFiredAt[id] ?? -1) < 0.16;
    if (id === 'burst') return { mode: 'conditional', progress: 0, active: false, fired };
    const timed = id in this.nextSkill;
    const skill = id as TimedSkill;
    const interval =
      (timed
        ? this.game.rules.skills[skill].periodSeconds / this.game.rate
        : this.game.attackInterval) * this.game.rules.tickRate;
    const next = timed ? this.nextSkill[skill] : this.nextAttack;
    const progress = Math.max(0, Math.min(1, 1 - (next - this.game.tick) / interval));
    const active =
      this.game.phase === 'running' &&
      (id === 'focus'
        ? this.focus.length > 0
        : id === 'wave'
          ? this.wave.length > 0
          : id === 'whip'
            ? this.whip.length > 0
            : false);
    return { mode: timed ? 'timed' : 'linked', progress, active, fired };
  }

  learn(id: UpgradeId, previous: number): void {
    if (id in this.nextSkill && previous === 0)
      this.nextSkill[id as TimedSkill] = this.game.tick + 1;
  }

  rescaleCooldowns(oldRate: number): void {
    const { tick, rate } = this.game;
    const ratio = oldRate / rate;
    this.nextAttack = tick + Math.max(0, this.nextAttack - tick) * ratio;
    for (const id of Object.keys(this.nextSkill) as TimedSkill[]) {
      if (Number.isFinite(this.nextSkill[id]))
        this.nextSkill[id] = tick + Math.max(0, this.nextSkill[id] - tick) * ratio;
    }
  }

  clear(): void {
    this.pulses = [];
    this.wave = [];
    this.whip = [];
    this.focus = [];
  }

  fireBasic(origin: Point = this.game.position): void {
    const forms = this.game.forms;
    const selected = closest(
      this.game.targets,
      origin,
      forms.multi.count,
      this.game.rules.primaryRange,
    );
    if (!selected.length) return;
    const attack: Attack = {
      id: this.nextAttackId++,
      ranks: { ...this.game.ranks },
      rarities: { ...this.game.rarities },
      forms,
      damage: this.game.damage,
      burstFired: false,
    };
    selected.forEach((target, order) => {
      for (let hit = 1; hit < forms.repeat.hits; hit++)
        this.pulses.push({
          at:
            this.game.tick +
            hit * this.game.rules.skills.repeat.delaySeconds * this.game.rules.tickRate,
          order,
          attack,
          target,
        });
      this.hitPulse({ at: this.game.tick, order, attack, target }, origin, false);
    });
  }

  fireSkill(id: TimedSkill, origin: Point = this.game.position): void {
    if (!this.game.ranks[id]) return;
    const attack = this.beginAttack(
      this.game.damage *
        (id === 'focus' ? this.game.forms.focus.damage : this.game.rules.skills[id].damage),
    );
    attack.source = id;
    this.castSkill(id, origin, attack);
    for (let hit = 1; hit < attack.forms.repeat.hits; hit++)
      this.pulses.push({
        at:
          this.game.tick +
          hit * this.game.rules.skills.repeat.delaySeconds * this.game.rules.tickRate,
        order: hit,
        attack,
        skill: id,
      });
  }

  private castSkill(id: TimedSkill, origin: Point, attack: Attack, repeated = false): boolean {
    const form = attack.forms,
      rarity = attack.rarities[id];
    const branches = form.multi.count;
    if (id === 'strike') {
      const selected = this.game.targets
        .filter((t) => t.hp > 0 && distance(t, origin) <= this.game.rules.skills.strike.range)
        .sort((a, b) => b.hp - a.hp || distance(a, origin) - distance(b, origin) || a.id - b.id)
        .slice(0, form.strike.count + branches - 1);
      if (!selected.length) return false;
      const hit = new Set<number>();
      for (const target of selected) {
        if (target.hp <= 0) continue;
        this.game.addEffect({
          kind: 'strike',
          from: { x: target.x, y: target.y - 180 },
          to: target,
          radius: form.strike.radius,
          width: 3,
          life: 0.24,
          source: id,
          rarity,
          rank: attack.ranks[id],
        });
        this.resolveHit(attack, target, origin, form.strike.radius, hit);
      }
      this.discharge(attack);
    } else if (id === 'focus') {
      const group = this.nextFocusId++;
      for (let i = 0; i < branches; i++)
        this.focus.push({
          attack,
          group,
          until: this.game.time + form.focus.duration,
          next: this.game.tick,
          repeated,
        });
    } else {
      const selected = closest(this.game.targets, origin, branches);
      const hit = new Set<number>();
      const pushed = new Set<number>();
      for (let i = 0; i < branches; i++) {
        const target = selected[i];
        const from =
          id === 'wave' && i > 0 && target
            ? { x: (origin.x + target.x) / 2, y: (origin.y + target.y) / 2 }
            : { ...origin };
        const angle =
          (target
            ? Math.atan2(target.y - origin.y, target.x - origin.x)
            : this.game.angle + Math.PI / 2 + (i * Math.PI * 2) / branches) -
          form.whip.arc / 2;
        this[id].push({
          attack,
          from,
          born: this.game.time,
          previous: 0,
          hit,
          pushed,
          angle,
          modified: false,
        });
        this.game.addEffect({
          kind: id,
          from,
          to: { x: from.x + Math.cos(angle), y: from.y + Math.sin(angle) },
          radius: id === 'wave' ? form.wave.radius : form.whip.length,
          width: id === 'wave' ? 1 : form.whip.arc,
          life: this.game.rules.skills[id].duration,
          source: id,
          rarity,
          anchor: id === 'whip' ? 'electron' : undefined,
          rank: attack.ranks[id],
        });
      }
    }
    if (id !== 'focus') this.activate(id, attack.ranks[id]);
    if (branches > 1 && attack.ranks.multi) this.activate('multi', attack.ranks.multi);
    return true;
  }

  movementScale(target: Target): number {
    let scale = 1;
    for (const cast of this.focus)
      if (
        cast.target === target &&
        this.game.time < cast.until &&
        distance(target, this.game.position) <= cast.attack.forms.focus.range
      )
        scale = Math.min(scale, cast.attack.forms.focus.slow);
    return scale;
  }

  private beginAttack(damage: number): Attack {
    return {
      id: this.nextAttackId++,
      ranks: { ...this.game.ranks },
      rarities: { ...this.game.rarities },
      forms: this.game.forms,
      damage,
      burstFired: false,
    };
  }

  private hitPulse(pulse: Pulse, origin: Point, repeat: boolean): void {
    const { attack } = pulse;
    let primary = pulse.target;
    if (!primary || primary.hp <= 0 || !this.game.targets.includes(primary)) {
      if (!repeat) return;
      primary = closest(this.game.targets, origin, 1, this.game.rules.primaryRange)[0];
      if (!primary) return;
    }
    const rarity = higherRarity(
      attack.rarities.power,
      higherRarity(attack.rarities.multi, attack.rarities.repeat),
    );
    const source =
      repeat && attack.ranks.repeat ? 'repeat' : attack.ranks.multi ? 'multi' : undefined;
    this.game.addEffect({
      kind: 'bolt',
      from: origin,
      to: primary,
      radius: 0,
      width: 1.8 + (attack.damage - this.game.rules.baseHitDamage) * 0.5,
      life: 0.14,
      source,
      rarity,
      anchor: 'electron',
      rank: source ? attack.ranks[source] : 0,
    });
    if (repeat && attack.ranks.repeat) this.activate('repeat', attack.ranks.repeat);
    if (!repeat && pulse.order > 0 && attack.ranks.multi)
      this.activate('multi', attack.ranks.multi);
    this.resolveHit(attack, primary, origin);
  }

  private resolveHit(
    attack: Attack,
    primary: Target,
    origin: Point,
    baseRadius = 0,
    visited = new Set<number>(),
    anchored = true,
  ): void {
    const s = attack.forms,
      radius = Math.max(baseRadius, s.area.radius),
      length = s.pierce.length,
      width = s.pierce.width;
    const direction = distance(primary, origin)
      ? norm({ x: primary.x - origin.x, y: primary.y - origin.y })
      : { x: -Math.sin(this.game.angle), y: Math.cos(this.game.angle) };
    if (s.area.radius) {
      this.game.addEffect({
        kind: 'area',
        from: primary,
        to: primary,
        radius: s.area.radius,
        width: 1,
        life: 0.38,
        source: 'area',
        rarity: attack.rarities.area,
        rank: attack.ranks.area,
      });
      this.activate('area', attack.ranks.area);
    }
    if (length) {
      this.game.addEffect({
        kind: 'pierce',
        from: origin,
        to: { x: origin.x + direction.x * length, y: origin.y + direction.y * length },
        radius: 0,
        width,
        life: 0.14,
        source: 'pierce',
        rarity: attack.rarities.pierce,
        anchor: anchored ? 'electron' : undefined,
        rank: attack.ranks.pierce,
      });
      this.activate('pierce', attack.ranks.pierce);
    }
    const hit = this.game.targets
      .filter((t) => {
        if (t.hp <= 0 || visited.has(t.id)) return false;
        if (t.id === primary.id || (radius > 0 && distance(t, primary) <= radius)) return true;
        if (!length) return false;
        const dx = t.x - origin.x,
          dy = t.y - origin.y,
          projection = dx * direction.x + dy * direction.y;
        return (
          projection >= 0 &&
          projection <= length &&
          Math.abs(dx * direction.y - dy * direction.x) <= width / 2
        );
      })
      .sort((a, b) => a.id - b.id);
    hit.forEach((t) => {
      visited.add(t.id);
      const full = !attack.source || t.id === primary.id || distance(t, primary) <= baseRadius;
      this.game.damageTarget(
        t,
        attack.damage * (full ? 1 : this.game.rules.combo.secondaryDamage),
        attack,
      );
    });
    visited.add(primary.id);
    let previous: Point = primary;
    for (let hop = 0; hop < s.chain.hops; hop++) {
      const next = closest(this.game.targets, previous, 1, s.chain.range, visited)[0];
      if (!next) break;
      this.game.addEffect({
        kind: 'bolt',
        from: previous,
        to: next,
        radius: 0,
        width: 1.2,
        life: 0.14,
        source: 'chain',
        rarity: attack.rarities.chain,
        rank: attack.ranks.chain,
      });
      this.activate('chain', attack.ranks.chain);
      this.game.damageTarget(
        next,
        attack.damage * (attack.source ? this.game.rules.combo.secondaryDamage : 1),
        attack,
      );
      visited.add(next.id);
      previous = next;
    }
    this.discharge(attack);
    this.fuse(attack, primary);
  }

  private fuse(attack: Attack, point: Point): void {
    if (!attack.source || attack.echo || attack.comboFired) return;
    attack.comboFired = true;
    const base =
      attack.damage /
      (attack.source === 'focus'
        ? attack.forms.focus.damage
        : this.game.rules.skills[attack.source].damage);
    for (const id of Object.keys(this.nextSkill) as TimedSkill[]) {
      if (id === attack.source || !attack.ranks[id]) continue;
      const echo: Attack = {
        ...attack,
        id: this.nextAttackId++,
        echo: true,
        source: id,
        comboFired: true,
        burstFired: false,
        firstKill: undefined,
        damage:
          base *
          (id === 'focus' ? attack.forms.focus.damage : this.game.rules.skills[id].damage) *
          this.game.rules.combo.echoDamage,
      };
      this.castSkill(id, id === 'wave' ? point : this.game.position, echo);
      this.game.log('skill-combo', { from: attack.source, to: id });
    }
  }

  private discharge(attack: Attack): void {
    if (attack.firstKill && attack.ranks.burst && !attack.burstFired) {
      attack.burstFired = true;
      const point = attack.firstKill,
        radius = attack.forms.burst.radius;
      const targets = closest(
        this.game.targets,
        point,
        attack.forms.burst.count + attack.forms.multi.count - 1,
        radius,
      );
      if (targets.length) this.activate('burst', attack.ranks.burst);
      const visited = new Set<number>();
      targets.forEach((t) => {
        if (t.hp <= 0 || visited.has(t.id)) return;
        this.game.addEffect({
          kind: 'bolt',
          from: point,
          to: t,
          radius: 0,
          width: 1.4,
          life: 0.14,
          source: 'burst',
          rarity: attack.rarities.burst,
          rank: attack.ranks.burst,
        });
        this.resolveHit(attack, t, point, 0, visited, false);
      });
    }
  }

  private updateTimedSkills(): void {
    for (const id of Object.keys(this.nextSkill) as TimedSkill[]) {
      if (
        this.nextSkill[id] > this.game.tick + 1e-8 ||
        (id === 'focus' && this.focus.some((cast) => !cast.attack.echo))
      )
        continue;
      this.fireSkill(id);
      this.nextSkill[id] =
        this.game.tick +
        (this.game.rules.skills[id].periodSeconds / this.game.rate) * this.game.rules.tickRate;
    }
    for (const id of ['wave', 'whip'] as const) {
      for (const cast of [...this[id]]) {
        const progress = Math.min(
          1,
          (this.game.time - cast.born) / this.game.rules.skills[id].duration,
        );
        const origin = id === 'wave' ? cast.from : this.game.position;
        for (const target of [...this.game.targets].sort((a, b) => a.id - b.id)) {
          if (target.hp <= 0 || (id !== 'wave' && cast.hit.has(target.id))) continue;
          const d = distance(target, origin),
            form = cast.attack.forms;
          let hit = false;
          if (id === 'wave') {
            hit =
              d <= form.wave.radius * progress + target.size &&
              d >= form.wave.radius * cast.previous - target.size;
          } else {
            const angle =
              (Math.atan2(target.y - origin.y, target.x - origin.x) - cast.angle + Math.PI * 4) %
              (Math.PI * 2);
            const padding = Math.atan2(target.size, Math.max(1, d));
            hit =
              d <= form.whip.length &&
              angle >= form.whip.arc * cast.previous - padding &&
              angle <= form.whip.arc * progress + padding;
          }
          if (!hit) continue;
          if (!cast.hit.has(target.id) && !cast.modified) {
            cast.modified = true;
            this.resolveHit(cast.attack, target, origin, 0, cast.hit, id !== 'wave');
          } else if (!cast.hit.has(target.id)) {
            cast.hit.add(target.id);
            this.game.damageTarget(target, cast.attack.damage, cast.attack);
          }
          if (id === 'wave' && target.hp > 0 && !cast.pushed.has(target.id)) {
            cast.pushed.add(target.id);
            target.radius = Math.min(this.game.rules.spawnRadius, target.radius + form.wave.push);
            Object.assign(target, orbit(target.angle, target.radius));
          }
        }
        this.discharge(cast.attack);
        cast.previous = progress;
        if (progress >= 1) this[id] = this[id].filter((c) => c !== cast);
      }
    }
    for (const cast of [...this.focus]) {
      if (this.game.time >= cast.until - 1e-8) {
        this.focus = this.focus.filter((c) => c !== cast);
        continue;
      }
      if (this.game.tick < cast.next - 1e-8) continue;
      const form = cast.attack.forms.focus,
        origin = this.game.position;
      if (
        !cast.target ||
        cast.target.hp <= 0 ||
        !this.game.targets.includes(cast.target) ||
        distance(cast.target, origin) > form.range
      ) {
        const reserved = new Set(
          this.focus.filter((c) => c !== cast && c.group === cast.group).map((c) => c.target?.id),
        );
        cast.target = this.game.targets
          .filter((t) => t.hp > 0 && !reserved.has(t.id) && distance(t, origin) <= form.range)
          .sort((a, b) => a.radius - a.size - (b.radius - b.size) || a.id - b.id)[0];
      }
      if (cast.target) {
        this.game.addEffect({
          kind: 'focus',
          from: origin,
          to: cast.target,
          radius: 0,
          width: 1.5,
          life: this.game.rules.skills.focus.tickSeconds,
          source: 'focus',
          rarity: cast.attack.rarities.focus,
          anchor: 'electron',
          rank: cast.attack.ranks.focus,
          targetId: cast.target.id,
        });
        this.resolveHit(cast.attack, cast.target, origin);
        this.activate('focus', cast.attack.ranks.focus);
        if (cast.repeated) this.activate('repeat', cast.attack.ranks.repeat);
      }
      cast.next += this.game.rules.skills.focus.tickSeconds * this.game.rules.tickRate;
    }
  }
  private activate(id: SkillId, rank = this.game.ranks[id]): void {
    this.activations[id] ??= this.game.time;
    this.skillFiredAt[id] = this.game.time;
    this.game.log('skill-effect', { id, rank });
  }
}
