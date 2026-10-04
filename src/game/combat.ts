import { distance, norm } from './geometry.ts';
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
};
type Pulse = { at: number; order: number; attack: Attack; target: Target };
type TimedSkill = 'strike' | 'wave' | 'whip' | 'focus';
type Sweep = {
  attack: Attack;
  from: Point;
  born: number;
  previous: number;
  hit: Set<number>;
  angle: number;
};
type Focus = { attack: Attack; until: number; next: number; target?: Target };
const closest = (targets: Target[], point: Point) =>
  [...targets].sort((a, b) => distance(a, point) - distance(b, point) || a.id - b.id);
export class Combat {
  private readonly game: Game;
  activations: Partial<Record<SkillId, number>> = {};
  private skillFiredAt: Partial<Record<SkillId, number>> = {};
  private nextAttack: number;
  private nextAttackId = 0;
  private pulses: Pulse[] = [];
  private nextSkill: Record<TimedSkill, number> = {
    strike: Infinity,
    wave: Infinity,
    whip: Infinity,
    focus: Infinity,
  };
  private wave: Sweep | null = null;
  private whip: Sweep | null = null;
  private focus: Focus | null = null;
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
    due.forEach((pulse) => this.hitPulse(pulse, game.position, true));
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
        ? this.focus !== null
        : id === 'wave'
          ? this.wave !== null
          : id === 'whip'
            ? this.whip !== null
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
    this.wave = null;
    this.whip = null;
    this.focus = null;
  }

  fireBasic(origin: Point = this.game.position): void {
    const forms = this.game.forms;
    const selected = closest(
      this.game.targets.filter(
        (t) => t.hp > 0 && distance(t, origin) <= this.game.rules.primaryRange,
      ),
      origin,
    ).slice(0, forms.multi.count);
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
    const cfg = this.game.rules.skills[id];
    const attack = this.beginAttack(
      this.game.damage * (id === 'focus' ? this.game.forms.focus.damage : cfg.damage),
    );
    const form = attack.forms,
      rarity = attack.rarities[id];
    if (id === 'strike') {
      const selected = this.game.targets
        .filter((t) => t.hp > 0 && distance(t, origin) <= this.game.rules.skills.strike.range)
        .sort((a, b) => b.hp - a.hp || distance(a, origin) - distance(b, origin) || a.id - b.id)
        .slice(0, form.strike.count);
      if (!selected.length) return;
      // A target can take one strike per cast, including overlapping impact areas.
      const hit = new Set<number>();
      for (const target of selected) {
        this.game.addEffect(
          'strike',
          { x: target.x, y: target.y - 180 },
          target,
          form.strike.radius,
          3,
          0.24,
          id,
          rarity,
        );
        for (const nearby of [...this.game.targets].sort((a, b) => a.id - b.id)) {
          if (nearby.hp <= 0 || hit.has(nearby.id) || distance(nearby, target) > form.strike.radius)
            continue;
          hit.add(nearby.id);
          this.game.damageTarget(nearby, attack.damage, attack);
        }
      }
      this.discharge(attack);
    } else if (id === 'focus') {
      this.focus = { attack, until: this.game.time + form.focus.duration, next: this.game.tick };
    } else {
      const target = closest(
        this.game.targets.filter((t) => t.hp > 0),
        origin,
      )[0];
      const angle =
        (target
          ? Math.atan2(target.y - origin.y, target.x - origin.x)
          : this.game.angle + Math.PI / 2) -
        form.whip.arc / 2;
      this[id] = {
        attack,
        from: { ...origin },
        born: this.game.time,
        previous: 0,
        hit: new Set(),
        angle,
      };
      // For a whip, `to` is its initial direction and `width` is the swept angle.
      this.game.addEffect(
        id,
        origin,
        { x: origin.x + Math.cos(angle), y: origin.y + Math.sin(angle) },
        id === 'wave' ? form.wave.radius : form.whip.length,
        id === 'wave' ? 1 : form.whip.arc,
        this.game.rules.skills[id].duration,
        id,
        rarity,
        id === 'whip' ? 'electron' : undefined,
      );
    }
    if (id !== 'focus') this.activate(id);
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
    const { attack, target: primary } = pulse;
    if (primary.hp <= 0 || !this.game.targets.includes(primary)) return;
    const s = attack.forms,
      radius = s.area.radius,
      length = s.pierce.length,
      width = s.pierce.width;
    const direction = distance(primary, origin)
      ? norm({ x: primary.x - origin.x, y: primary.y - origin.y })
      : { x: -Math.sin(this.game.angle), y: Math.cos(this.game.angle) };
    const rarity = higherRarity(
      attack.rarities.power,
      higherRarity(attack.rarities.multi, attack.rarities.repeat),
    );
    this.game.addEffect(
      'bolt',
      origin,
      primary,
      0,
      1.8 + (attack.damage - this.game.rules.baseHitDamage) * 0.5,
      0.32,
      undefined,
      rarity,
      'electron',
    );
    if (repeat && attack.ranks.repeat) this.activate('repeat', attack.ranks.repeat);
    if (!repeat && pulse.order > 0 && attack.ranks.multi)
      this.activate('multi', attack.ranks.multi);
    if (radius) {
      this.game.addEffect('area', primary, primary, radius, 1, 0.38, 'area', attack.rarities.area);
      this.activate('area', attack.ranks.area);
    }
    if (length) {
      this.game.addEffect(
        'pierce',
        origin,
        { x: origin.x + direction.x * length, y: origin.y + direction.y * length },
        0,
        width,
        0.3,
        'pierce',
        attack.rarities.pierce,
        'electron',
      );
      this.activate('pierce', attack.ranks.pierce);
    }
    const hit = this.game.targets
      .filter((t) => {
        if (t.hp <= 0) return false;
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
    hit.forEach((t) => this.game.damageTarget(t, attack.damage, attack));
    let previous: Point = primary;
    const visited = new Set([primary.id]);
    for (let hop = 0; hop < s.chain.hops; hop++) {
      const next = closest(
        this.game.targets.filter(
          (t) => t.hp > 0 && !visited.has(t.id) && distance(t, previous) <= s.chain.range,
        ),
        previous,
      )[0];
      if (!next) break;
      this.game.addEffect('bolt', previous, next, 0, 1.2, 0.34, 'chain', attack.rarities.chain);
      this.activate('chain', attack.ranks.chain);
      this.game.damageTarget(next, attack.damage, attack);
      visited.add(next.id);
      previous = next;
    }
    this.discharge(attack);
  }

  private discharge(attack: Attack): void {
    if (attack.firstKill && attack.ranks.burst && !attack.burstFired) {
      attack.burstFired = true;
      const point = attack.firstKill,
        radius = attack.forms.burst.radius;
      const targets = this.game.targets.filter((t) => t.hp > 0 && distance(t, point) <= radius);
      if (targets.length) this.activate('burst', attack.ranks.burst);
      closest(targets, point)
        .slice(0, attack.forms.burst.count)
        .forEach((t) => {
          this.game.addEffect('bolt', point, t, 0, 1.4, 0.14, 'burst', attack.rarities.burst);
          this.game.damageTarget(t, attack.damage);
        });
    }
  }

  private updateTimedSkills(): void {
    for (const id of Object.keys(this.nextSkill) as TimedSkill[]) {
      if (this.nextSkill[id] > this.game.tick + 1e-8 || (id === 'focus' && this.focus)) continue;
      this.fireSkill(id);
      this.nextSkill[id] =
        this.game.tick +
        (this.game.rules.skills[id].periodSeconds / this.game.rate) * this.game.rules.tickRate;
    }
    for (const id of ['wave', 'whip'] as const) {
      const cast = this[id];
      if (!cast) continue;
      const progress = Math.min(
        1,
        (this.game.time - cast.born) / this.game.rules.skills[id].duration,
      );
      const origin = id === 'wave' ? cast.from : this.game.position;
      for (const target of [...this.game.targets].sort((a, b) => a.id - b.id)) {
        if (cast.hit.has(target.id)) continue;
        const d = distance(target, origin);
        const form = cast.attack.forms;
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
        cast.hit.add(target.id);
        this.game.damageTarget(target, cast.attack.damage, cast.attack);
      }
      this.discharge(cast.attack);
      cast.previous = progress;
      if (progress >= 1) this[id] = null;
    }
    if (this.focus) {
      const cast = this.focus;
      if (this.game.time >= cast.until - 1e-8) {
        this.focus = null;
        return;
      }
      if (this.game.tick < cast.next - 1e-8) return;
      const form = cast.attack.forms.focus,
        origin = this.game.position;
      if (
        !cast.target ||
        cast.target.hp <= 0 ||
        !this.game.targets.includes(cast.target) ||
        distance(cast.target, origin) > form.range
      ) {
        cast.target = closest(
          this.game.targets.filter((t) => t.hp > 0 && distance(t, origin) <= form.range),
          origin,
        )[0];
      }
      if (cast.target) {
        this.game.addEffect(
          'focus',
          origin,
          cast.target,
          0,
          1.5,
          this.game.rules.skills.focus.tickSeconds,
          'focus',
          cast.attack.rarities.focus,
          'electron',
        ).targetId = cast.target.id;
        this.game.damageTarget(cast.target, cast.attack.damage, cast.attack);
        this.activate('focus', cast.attack.ranks.focus);
        this.discharge(cast.attack);
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
