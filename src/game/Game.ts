import { Combat } from './combat.ts';
import { CENTER, TAU, clamp, distance, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { familyBase, particleMotion } from './particles.ts';
import type { Family, ParticleKind } from './particles.ts';
import { eligibleUpgrades, offerCards } from './growth.ts';
import { Random } from './random.ts';
import {
  blankBoosts,
  blankRanks,
  coreRadius,
  isSkill,
  isStat,
  levelForXp,
  orbitTarget,
  powerScale,
  rangeScale,
  rarityIds,
  recoveryMass,
  rollRarity,
  rules as defaultRules,
  rulesHash,
  skillIds,
  xpForLevel,
} from './rules.ts';
import type { Card, PopStyle, Rarity, Rules, SkillId, UpgradeId } from './rules.ts';
import { skillValues } from './skills.ts';
import type { SkillValues } from './skills.ts';
import type {
  DamageNumber,
  Effect,
  EffectInput,
  Event,
  Input,
  Outcome,
  Phase,
  Result,
  RunRecord,
  Selection,
  Target,
} from './types.ts';

type Stage = Rules['stages'][number];
type Member = Omit<Target, 'id' | 'x' | 'y' | 'born' | 'maxHp'>;
type Shared = { speed: number; turn: number };
export type Choice = { cards: Card[]; number: number };

const damageNumberSeconds = 0.72,
  maxDamageNumbers = 64,
  maxEffects = 160;

export class Game {
  readonly rules: Rules;
  readonly seed: number;
  readonly combatEnabled: boolean;
  readonly combat: Combat;
  phase: Phase = 'ready';
  // Running combat ticks; `elapsedTicks` also counts phase transitions.
  tick = 0;
  elapsedTicks = 0;
  phaseTicks = 0;
  pendingTicks = 0;
  xp = 0;
  mass = 0;
  radius: number;
  angle = -Math.PI / 2;
  ranks = blankRanks();
  boosts = blankBoosts();
  // The rarity a skill was first taken at; it keeps it for the run.
  rarities: Partial<Record<UpgradeId, Rarity>> = {};
  evolved: Partial<Record<SkillId, boolean>> = {};
  forms: SkillValues;
  choice: Choice | null = null;
  selections: Selection[] = [];
  targets: Target[] = [];
  effects: Effect[] = [];
  damageNumbers: DamageNumber[] = [];
  events: Event[] = [];
  eventOffset = 0;
  inputs: Input[] = [];
  result: Result | null = null;
  collisionTime = 0;
  private readonly recordEvents: boolean;
  private readonly random: Record<'spawn' | 'cards' | 'rarity' | 'crit' | 'wave', Random>;
  outcome: Outcome = 'collapse-failure';
  private nextSpawn = 0;
  private batches = 0;
  private nextId = 0;
  private nextDamageId = 0;
  private orbitRecovery = 0;
  private xpRemainder = 0;
  private popTick = -1;
  private popOrder: Partial<Record<PopStyle, number>> = {};

  constructor(
    seed: number,
    options: { combat?: boolean; rules?: Rules; recordEvents?: boolean } = {},
  ) {
    this.rules = options.rules ?? defaultRules;
    this.seed = seed >>> 0;
    this.combatEnabled = options.combat ?? true;
    this.recordEvents = options.recordEvents ?? true;
    this.radius = this.rules.orbit.radius;
    const stream = (name: string) => new Random(this.seed, name);
    this.random = {
      spawn: stream('spawn'),
      cards: stream('cards'),
      rarity: stream('rarity'),
      crit: stream('crit'),
      wave: stream('wave'),
    };
    this.forms = skillValues(this.ranks, this.rarities, this.rules);
    this.combat = new Combat(this);
  }

  get time(): number {
    return this.tick / this.rules.time.tickRate;
  }
  get seconds(): number {
    return this.elapsedTicks / this.rules.time.tickRate;
  }
  get eventCount(): number {
    return this.eventOffset + this.events.length;
  }
  get level(): number {
    return levelForXp(this.xp, this.rules);
  }
  get levelProgress(): { current: number; required: number } {
    const previous = xpForLevel(this.level, this.rules);
    return {
      current: this.xp - previous,
      required: xpForLevel(this.level + 1, this.rules) - previous,
    };
  }
  get core(): number {
    return coreRadius(this.mass, this.rules);
  }
  get margin(): number {
    return this.radius - this.core - this.rules.orbit.electronRadius;
  }
  get position(): Point {
    return orbit(this.angle, this.radius);
  }
  get range(): number {
    return this.rules.orbit.range * rangeScale(this.boosts.range, this.rules);
  }
  get damage(): number {
    return this.rules.combat.baseDamage * powerScale(this.boosts.power, this.rules);
  }
  get rate(): number {
    return 1 + this.rules.combat.ratePerRank * this.boosts.rate;
  }
  get attackInterval(): number {
    return this.rules.combat.attackSeconds / this.rate;
  }
  // Skill values follow ranks, rarities and range; call after changing any of them.
  refresh(): void {
    this.forms = skillValues(
      this.ranks,
      this.rarities,
      this.rules,
      rangeScale(this.boosts.range, this.rules),
    );
  }
  get skillSlots(): number {
    return this.rules.growth.skillSlots;
  }
  get ownedSkills(): SkillId[] {
    return skillIds.filter((id) => this.ranks[id] > 0);
  }
  get recoverable(): boolean {
    return this.mass >= this.rules.growth.recovery.minMass;
  }
  get danger(): boolean {
    return this.margin < this.rules.orbit.dangerMargin;
  }
  rank(id: UpgradeId): number {
    return isSkill(id) ? this.ranks[id] : isStat(id) ? this.boosts[id] : 0;
  }
  canUpgrade(id: UpgradeId): boolean {
    return eligibleUpgrades(this.ranks, this.rules, this.recoverable, this.skillSlots).includes(id);
  }
  // Mass release in danger, then early attack upgrades, then the highest rarity.
  get automaticCard(): Card | undefined {
    const cards = this.choice?.cards.filter((card) => this.canUpgrade(card.id)) ?? [],
      g = this.rules.growth;
    return (
      cards.find((card) => card.id === 'recover' && this.danger) ??
      cards.find(
        ({ id }) => (id === 'power' || id === 'rate') && this.boosts[id] < g.autoStatRank,
      ) ??
      cards.reduce<Card | undefined>(
        (a, b) => (!a || rarityIds.indexOf(b.rarity) > rarityIds.indexOf(a.rarity) ? b : a),
        undefined,
      )
    );
  }
  get stage(): number {
    return this.rules.stages.filter((s) => this.time >= s.start).length - 1;
  }
  get phaseProgress(): number {
    const t = this.rules.time;
    const seconds =
      this.phase === 'collapse'
        ? t.collisionSeconds
        : this.phase === 'crossing'
          ? t.beyondSeconds
          : this.outcome === 'success'
            ? t.successEndingSeconds
            : t.failureEndingSeconds;
    return this.phaseTicks / (seconds * t.tickRate);
  }
  get record(): RunRecord {
    return {
      seed: this.seed,
      rules: rulesHash(this.rules),
      ticks: this.elapsedTicks,
      inputs: this.inputs.map((input) => ({ ...input })),
    };
  }
  // Seeded apart so critical rolls never shift spawns or cards.
  critRoll(): number {
    return this.random.crit.next();
  }

  start(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'running';
    this.log('start', { seed: this.seed });
    if (!this.combatEnabled) return;
    this.spawnBatch();
    this.nextSpawn = this.staged((s) => s.spawnSeconds) * this.rules.time.tickRate;
  }

  // With `holdAtChoice`, combat stops as soon as cards are on offer.
  advance(milliseconds: number, tickLimit = Infinity, holdAtChoice = false): void {
    if (this.phase === 'ready' || this.phase === 'result') return;
    this.pendingTicks += (milliseconds * this.rules.time.tickRate) / 1000;
    const count = Math.min(Math.floor(this.pendingTicks + 1e-8), tickLimit);
    this.pendingTicks -= count;
    this.run(count, holdAtChoice);
    if (holdAtChoice && this.choice) this.pendingTicks = 0;
  }

  // Up to `ticks` fixed steps, stopping at the result.
  run(ticks: number, holdAtChoice = false): void {
    for (
      let i = 0;
      i < ticks &&
      this.phase !== 'result' &&
      this.phase !== 'ready' &&
      !(holdAtChoice && this.choice);
      i++
    ) {
      this.elapsedTicks++;
      if (this.phase === 'running') this.step();
      else this.transition();
      this.expireEffects();
    }
  }

  private step(): void {
    this.tick++;
    if (this.combatEnabled && this.tick + 1e-8 >= this.nextSpawn) {
      this.spawnBatch();
      this.nextSpawn +=
        this.staged((s) => s.spawnSeconds) *
        this.rules.time.tickRate *
        (1 + this.random.spawn.spread() * this.rules.spawn.variation.intervalFraction);
    }
    this.moveTargets();
    this.angle += this.rules.orbit.speed / this.radius / this.rules.time.tickRate;
    this.combat.update();
    if (this.absorbTargets()) return this.beginCollapse('boss-absorbed');
    this.updateOrbit();
    if (this.margin <= 0) this.beginCollapse('gravity');
  }

  private transition(): void {
    this.phaseTicks++;
    if (this.phaseProgress < 1) return;
    this.phaseTicks = 0;
    if (this.phase === 'crossing') {
      this.phase = 'running';
      this.log('beyond-ready', {});
    } else if (this.phase === 'collapse') {
      this.phase = 'ending';
      this.log('ending', { outcome: this.outcome });
    } else this.finishResult();
  }

  // Stage values climb geometrically toward the next stage's, so a stage start is no wall.
  staged(pick: (stage: Stage) => number, stage = this.stage): number {
    const stages = this.rules.stages,
      next = stages[stage + 1];
    if (!next) return pick(stages[stage]);
    const progress = clamp((this.time - stages[stage].start) / (next.start - stages[stage].start));
    return pick(stages[stage]) * (pick(next) / pick(stages[stage])) ** progress;
  }

  // Shares blend linearly from the previous stage's over the first `spawn.ramp` of a stage.
  ramped(pick: (stage: Stage) => number): number {
    const stage = this.stage,
      stages = this.rules.stages;
    if (!stage) return pick(stages[0]);
    const start = stages[stage].start,
      length = (stages[stage + 1]?.start ?? 2 * start - stages[stage - 1].start) - start;
    const blend = Math.min(1, clamp((this.time - start) / length) / this.rules.spawn.ramp);
    return pick(stages[stage - 1]) + (pick(stages[stage]) - pick(stages[stage - 1])) * blend;
  }

  spawnBatch(): void {
    const r = this.random.spawn,
      cfg = this.rules.spawn,
      v = cfg.variation;
    const roll = r.next(),
      angle = r.next() * TAU,
      direction = r.next() < 0.5 ? -1 : 1;
    const intro = this.batches < cfg.introBatches;
    const family: Family = intro || roll < this.ramped((s) => s.smallChance) ? 'small' : 'dense';
    const size = family === 'small' ? cfg.smallBatchSize : cfg.denseBatchSize;
    const count = intro
      ? cfg.introBatchSize
      : Math.max(
          1,
          Math.round(size * this.staged((s) => s.batchScale) * (1 + r.spread() * v.batchFraction)),
        );
    const center = intro
      ? this.angle + v.introAngleMin + r.next() * (v.introAngleMax - v.introAngleMin)
      : angle;
    this.batches++;
    this.spawnGroup(family, count, center, direction);
  }

  // Small particles come in tight packs along the arc; dense ones at even gaps.
  private spawnGroup(family: Family, count: number, angle: number, direction: number): void {
    const r = this.random.spawn,
      cfg = this.rules.spawn,
      offsets: number[] = [];
    if (family === 'small') {
      const { size, spacing, gap } = cfg.pack;
      for (let at = 0; offsets.length < count; at += gap - spacing) {
        const pack = size[0] + Math.floor(r.next() * (size[1] - size[0] + 1));
        for (let i = 0; i < pack && offsets.length < count; i++, at += spacing) offsets.push(at);
      }
    } else for (let i = 0; i < count; i++) offsets.push(i * cfg.denseSpacing);
    const middle = (offsets[0] + offsets.at(-1)!) / 2;
    this.place(
      offsets.map((offset) =>
        this.member(
          family,
          angle + offset - middle + r.spread() * cfg.variation.angleJitter,
          this.rules.orbit.spawnRadius + r.next() * cfg.variation.radiusSpread,
          direction,
        ),
      ),
    );
  }

  // `shared` keeps a formation or a tether moving together; species scale from their family.
  private member(
    family: Family,
    angle: number,
    radius: number,
    direction: number,
    particle: ParticleKind = familyBase[family],
    shared?: Shared,
  ): Member {
    const p = this.rules.particles[particle],
      base = this.rules.particles[familyBase[family]];
    const speed =
      shared?.speed ??
      base.speed * (1 + this.random.spawn.spread() * this.rules.spawn.variation.speedFraction);
    return {
      kind: family,
      particle,
      angle,
      radius,
      hp: Math.round(this.staged((s) => s.hp[family]) * p.hp),
      xp: p.xp,
      mass: p.mass,
      size: p.size,
      speed: (speed * p.speed) / base.speed,
      turn: (shared?.turn ?? base.turn * direction) * (base.turn ? p.turn / base.turn : 1),
    };
  }

  private place(members: Member[]): void {
    const placed = [];
    for (const member of members) {
      const target: Target = {
        ...member,
        id: this.nextId++,
        ...orbit(member.angle, member.radius),
        born: this.time,
        maxHp: member.hp,
        ...(this.rules.particles[member.particle].veiled && { veiled: true }),
      };
      this.targets.push(target);
      placed.push({ id: target.id, particle: target.particle, angle: target.angle, hp: target.hp });
    }
    if (placed.length) this.log('spawn', { placed });
  }

  private moveTargets(): void {
    const tickRate = this.rules.time.tickRate;
    for (const t of this.targets) {
      const motion = particleMotion(this.rules.particles[t.particle], this.time - t.born);
      t.radius = Math.max(0, t.radius - (t.speed * motion.speed) / tickRate);
      t.angle += (t.turn * motion.turn) / tickRate;
      Object.assign(t, orbit(t.angle, t.radius));
    }
  }

  // Missed particles feed the core; reports whether the final boss reached it.
  private absorbTargets(): boolean {
    const core = this.core,
      absorbed = this.targets.filter((t) => t.hp > 0 && t.radius <= core + t.size);
    for (const t of absorbed) {
      this.mass += t.mass;
      this.addEffect({
        kind: 'absorb',
        from: t,
        to: CENTER,
        radius: this.core + 10,
        width: 1,
        life: 0.5,
      });
      this.log('absorb', { id: t.id, kind: t.kind, particle: t.particle, mass: this.mass });
    }
    if (absorbed.length) this.targets = this.targets.filter((t) => !absorbed.includes(t));
    return absorbed.some((t) => t.final);
  }

  releaseMass(amount: number): number {
    const removed = Math.min(this.mass, amount),
      room = this.rules.orbit.radius - this.radius;
    this.mass -= removed;
    this.orbitRecovery = Math.min(
      room,
      this.orbitRecovery + removed * this.rules.orbit.gravityPerMass,
    );
    return removed;
  }

  private updateOrbit(): void {
    const o = this.rules.orbit,
      tickRate = this.rules.time.tickRate;
    if (this.orbitRecovery > 0) {
      const change = Math.min(
        this.orbitRecovery,
        o.outwardSpeed / tickRate,
        o.radius - this.radius,
      );
      this.radius += change;
      this.orbitRecovery -= change;
      if (this.orbitRecovery < 1e-8 || this.radius >= o.radius) this.orbitRecovery = 0;
      return;
    }
    const change = orbitTarget(this.mass, this.rules) - this.radius,
      speed = (change < 0 ? o.inwardSpeed : o.outwardSpeed) / tickRate;
    this.radius += Math.sign(change) * Math.min(Math.abs(change), speed);
  }

  damageTarget(
    target: Target,
    damage: number,
    crit = false,
    style: PopStyle = 'tap',
    from?: Point,
  ): void {
    if (target.hp <= 0) return;
    const index = this.targets.indexOf(target);
    if (index === -1) return;
    target.hitAt = this.time;
    if (target.veiled) {
      target.veiled = false;
      this.log('reveal', { id: target.id, x: target.x, y: target.y });
      return;
    }
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp < 1e-8) target.hp = 0;
    const { x, y } = target;
    this.log('hit', {
      id: target.id,
      kind: target.kind,
      particle: target.particle,
      damage,
      x,
      y,
      ...(crit && { crit }),
    });
    this.damageNumbers.push({
      id: this.nextDamageId++,
      x,
      y,
      value: damage,
      born: this.seconds,
      ...(crit && { crit }),
    });
    if (this.damageNumbers.length > maxDamageNumbers) this.damageNumbers.shift();
    if (target.hp > 0) return;
    this.targets.splice(index, 1);
    const delay = this.popDelay(style, target, from);
    this.addEffect({
      kind: 'kill',
      from: target,
      to: this.position,
      // Kills that pop all at once throw bigger debris.
      radius:
        (target.kind === 'boss' ? 36 : target.kind === 'dense' ? 11 : 6) *
        (style === 'burst' ? this.rules.combat.pops.burst.debris : 1),
      width: damage,
      life: 0.4 + delay,
      particle: target.particle,
      delay,
    });
    const previous = this.level;
    this.gainXp(target.xp);
    this.log('kill', {
      id: target.id,
      kind: target.kind,
      particle: target.particle,
      xp: this.xp,
      x,
      y,
      delay,
      style,
    });
    if (this.level > previous) {
      this.log('level', { level: this.level, xp: this.xp });
      this.addEffect({
        kind: 'level',
        from: this.position,
        to: this.position,
        radius: 24,
        width: 1,
        life: 0.5,
      });
      this.openChoice();
    }
  }

  // Kills in one tick pop in their style's rhythm: lines in order along the line,
  // the others one after another at the style's interval.
  private popDelay(style: PopStyle, target: Target, from?: Point): number {
    const cfg = this.rules.combat.pops;
    if (style === 'sweep')
      return Math.min(cfg.sweep.max, distance(target, from ?? this.position) / cfg.sweep.speed);
    if (this.popTick !== this.tick) {
      this.popTick = this.tick;
      this.popOrder = {};
    }
    const order = this.popOrder[style] ?? 0;
    this.popOrder[style] = order + 1;
    return Math.min(cfg[style].max, order * cfg[style].stagger);
  }

  private openChoice(): void {
    if (this.phase !== 'running' || this.choice || this.selections.length >= this.level - 1) return;
    const number = this.selections.length + 1;
    const ids = offerCards(
      {
        ranks: this.ranks,
        boosts: this.boosts,
        number,
        danger: this.danger,
        recoverable: this.recoverable,
        slots: this.skillSlots,
      },
      this.random.cards,
      this.rules,
    );
    // Stats are always common; a skill keeps the rarity it was first taken at.
    const cards = ids.map((id): Card => {
      const rolled = rollRarity(this.random.rarity.next(), this.boosts.luck, this.rules);
      return { id, rarity: isStat(id) ? 'common' : (this.rarities[id] ?? rolled) };
    });
    this.choice = { cards, number };
    this.log('cards', { number, cards });
  }

  // Takes a card between ticks and records it for replay; stale or unknown picks do nothing.
  choose(id: UpgradeId, number: number): boolean {
    const card = this.choice?.cards.find((c) => c.id === id);
    if (this.phase !== 'running' || this.choice?.number !== number || !card || !this.canUpgrade(id))
      return false;
    this.inputs.push({ tick: this.elapsedTicks, kind: 'card', id, number });
    const oldRate = this.rate;
    if (isSkill(id)) {
      this.rarities[id] ??= card.rarity;
      this.ranks[id]++;
      this.refresh();
      this.combat.learn(id);
    } else if (isStat(id)) this.boosts[id]++;
    else if (id === 'recover') {
      const removed = this.releaseMass(recoveryMass(card.rarity, this.rules));
      this.log('recover', { removed, mass: this.mass });
    }
    this.refresh();
    if (this.rate !== oldRate) this.combat.rescale(oldRate);
    const selection = {
      time: this.time,
      id,
      rank: this.rank(id),
      rarity: card.rarity,
      evolve: false,
    };
    this.selections.push(selection);
    this.log('skill', selection);
    this.addEffect({
      kind: 'upgrade',
      from: id === 'recover' ? CENTER : this.position,
      to: this.position,
      radius: id === 'recover' ? this.core + 14 : id === 'range' ? this.range : 18,
      width: 1,
      life: 0.7,
      source: id,
      rarity: card.rarity,
      anchor: id === 'recover' ? undefined : 'electron',
    });
    this.choice = null;
    this.openChoice();
    return true;
  }

  private gainXp(amount: number): void {
    const gained = amount + this.xpRemainder,
      whole = Math.floor(gained + 1e-8);
    this.xpRemainder = Math.max(0, gained - whole);
    this.xp += whole;
  }

  private beginCollapse(trigger: 'gravity' | 'boss-absorbed' | 'boss'): void {
    this.outcome = trigger === 'boss' ? 'success' : 'collapse-failure';
    this.collisionTime = this.time;
    this.phase = 'collapse';
    this.phaseTicks = 0;
    this.damageNumbers = [];
    this.choice = null;
    this.log('collision', { trigger, outcome: this.outcome, xp: this.xp, mass: this.mass });
  }

  private finishResult(): void {
    this.phase = 'result';
    this.result = {
      outcome: this.outcome,
      xp: this.xp,
      level: this.level,
      mass: this.mass,
      seed: this.seed,
      collisionTime: this.collisionTime,
      seconds: this.seconds,
      round: 1,
      ranks: { ...this.ranks },
      boosts: { ...this.boosts },
      rarities: { ...this.rarities },
      evolved: { ...this.evolved },
      selections: this.selections.map((s) => ({ ...s })),
      endless: null,
    };
    this.log('result', { outcome: this.outcome });
  }

  private expireEffects(): void {
    const now = this.seconds;
    this.effects = this.effects.filter((fx) => now < fx.born + fx.life);
    this.damageNumbers = this.damageNumbers.filter((d) => now < d.born + damageNumberSeconds);
  }

  addEffect(input: EffectInput): void {
    const { from, to, arc, ...rest } = input;
    this.effects.push({
      ...rest,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      ...(arc && { arc: { ...arc } }),
      damage: input.damage ?? 0,
      rank: input.rank ?? 0,
      rarity: input.rarity ?? 'common',
      born: this.seconds,
    });
    if (this.effects.length > maxEffects) {
      const discard = this.effects.findIndex((fx) =>
        ['kill', 'absorb', 'charge', 'field'].includes(fx.kind),
      );
      this.effects.splice(Math.max(0, discard), 1);
    }
  }

  log(kind: string, data: Record<string, unknown>): void {
    this.events.push({ time: this.time, kind, data });
    // The browser keeps the last quarter second once the log grows long.
    if (!this.recordEvents && this.events.length > 1024) {
      const discard = this.events.findIndex((event) => event.time >= this.time - 0.25);
      if (discard > 0) {
        this.events.splice(0, discard);
        this.eventOffset += discard;
      }
    }
  }
}
