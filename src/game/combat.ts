import { distance, norm } from './geometry.ts';
import type { Point } from './geometry.ts';
import { critChance } from './rules.ts';
import type { PopStyle, SkillId } from './rules.ts';
import { linkedSkills } from './skills.ts';
import { closest, onSegment } from './targeting.ts';
import type { Game } from './Game.ts';
import type { Effect, Target } from './types.ts';

// How the kills of one hit pop; lines sweep outward from where they start.
export type Pop = { style: PopStyle; from?: Point };
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
};
// Work that lands a few ticks later.
type Work = { at: number; order: number; attack: Attack } & {
  kind: 'hit';
  target: Target;
  from: Point;
  anchored: boolean;
};
type Style = {
  radius?: number;
  life?: number;
  anchored?: boolean;
  source?: SkillId;
  width?: number;
};

export class Combat {
  private readonly game: Game;
  private nextAttack: number;
  private scheduled: Work[] = [];
  private order = 0;
  // When each skill last fired, for the loadout.
  readonly fired: Partial<Record<SkillId, number>> = {};

  constructor(game: Game) {
    this.game = game;
    this.nextAttack = game.attackInterval * game.rules.time.tickRate;
  }

  update(): void {
    const g = this.game,
      due = this.scheduled.filter((w) => w.at <= g.tick + 1e-8);
    if (due.length) {
      this.scheduled = this.scheduled.filter((w) => w.at > g.tick + 1e-8);
      for (const work of due.sort((a, b) => a.at - b.at || a.order - b.order)) this.repeatHit(work);
    }
    if (!g.combatEnabled || g.tick + 1e-8 < this.nextAttack || !this.fireBasic()) return;
    // Regular fire keeps its fractional cadence; an attack that waited idle starts afresh.
    const at = g.tick - this.nextAttack < 1 + 1e-8 ? this.nextAttack : g.tick;
    this.nextAttack = at + g.attackInterval * g.rules.time.tickRate;
  }

  // A rate change stretches the wait already under way.
  rescale(oldRate: number): void {
    const { tick, rate } = this.game;
    this.nextAttack = tick + Math.max(0, this.nextAttack - tick) * (oldRate / rate);
  }

  fireBasic(origin: Point = this.game.position): boolean {
    const attack = this.begin(),
      selected = closest(this.game.targets, origin, this.game.forms.multi.count, attack.range);
    this.volley(attack, origin, selected, true);
    return selected.length > 0;
  }

  private schedule(seconds: number, work: Omit<Work, 'at' | 'order'>): void {
    const g = this.game;
    this.scheduled.push({
      ...work,
      at: g.tick + seconds * g.rules.time.tickRate,
      order: this.order++,
    });
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
  private derive(attack: Attack, damage: number, depth = attack.depth): Attack {
    return { ...attack, damage, depth, firstKill: undefined };
  }
  private secondary(attack: Attack, source: SkillId, multiplier: number): Attack {
    return { ...this.derive(attack, attack.power * multiplier, attack.depth + 1), source };
  }

  // Each primary also queues its Repeat hits; Fork splits the damage across primaries.
  private volley(attack: Attack, origin: Point, selected: Target[], anchored: boolean): number {
    const g = this.game,
      forms = g.forms;
    let fired = 0;
    if (g.ranks.multi && selected.length > 1) attack.fork = true;
    for (const [i, target] of selected.entries()) {
      if (target.hp <= 0) continue;
      const branch =
        i && g.ranks.multi ? this.derive(attack, attack.damage * forms.multi.damage) : attack;
      for (let hit = 1; hit < forms.repeat.hits; hit++)
        this.schedule(hit * g.rules.skills.repeat.delaySeconds, {
          kind: 'hit',
          attack: this.derive(branch, branch.damage * forms.repeat.damage),
          target,
          from: { ...origin },
          anchored,
        });
      this.emit(branch, origin, target, anchored);
      fired++;
    }
    if (fired > 1) this.activate('multi');
    return fired;
  }

  private repeatHit(work: Work): void {
    const g = this.game,
      from = work.anchored ? g.position : work.from;
    const target =
      work.target.hp > 0 && g.targets.includes(work.target)
        ? work.target
        : closest(g.targets, from, 1, work.attack.range)[0];
    if (!target) return;
    this.emit(work.attack, from, target, work.anchored, true);
    this.activate('repeat');
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
      : (attack.source ?? (this.game.ranks.multi ? 'multi' : undefined));
    this.effect(attack, 'bolt', origin, target, { anchored, source }, target.id);
    this.resolve(attack, target, origin, anchored);
  }

  private resolve(attack: Attack, primary: Target, origin: Point, anchored: boolean): void {
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
    }
    this.discharge(attack);
  }

  // Death Arc: an attack's first kill throws a burst at the particles around it, once.
  private discharge(attack: Attack): void {
    const g = this.game,
      forms = g.forms;
    if (!attack.firstKill || !g.ranks.burst || attack.budget.burst || attack.depth >= 2) return;
    attack.budget.burst = true;
    const from = attack.firstKill,
      targets = closest(
        g.targets,
        from,
        forms.burst.count + forms.multi.count - 1,
        forms.burst.radius,
      );
    if (targets.length) this.activate('burst');
    this.volley(this.secondary(attack, 'burst', forms.burst.damage), from, targets, false);
  }

  // Critical hits roll on their own stream; the first kill of an attack is remembered.
  deal(attack: Attack, target: Target, base: number, pop?: Pop): void {
    if (target.hp <= 0) return;
    const g = this.game,
      crit = g.critRoll() < critChance(g.boosts.crit, g.rules),
      at = { x: target.x, y: target.y };
    const style =
      pop?.style ??
      (attack.source ? g.rules.skills[attack.source].pop : attack.fork ? 'burst' : 'tap');
    g.damageTarget(
      target,
      crit ? base * g.rules.combat.crit.multiplier : base,
      crit,
      style,
      pop?.from,
    );
    if (target.hp <= 0) attack.firstKill ??= at;
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
      damage: attack.damage,
      source,
      rarity: (source && g.rarities[source]) || 'common',
      rank: source ? g.ranks[source] : 0,
      anchor: anchored ? 'electron' : undefined,
      targetId,
    });
  }

  private activate(id: SkillId): void {
    const g = this.game;
    if (!g.ranks[id]) return;
    this.fired[id] = g.time;
    if (linkedSkills.includes(id)) g.log('skill-effect', { id, rank: g.ranks[id] });
  }
}
