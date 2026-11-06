import { Combat } from './combat.ts';
import { bossPhase } from './bosses.ts';
import type { BossKind } from './bosses.ts';
import { formationSlots, formationsAt, interleave } from './formations.ts';
import type { FormationId, Shape } from './formations.ts';
import { CENTER, TAU, clamp, distance, goldenAngle, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { familyBase, particleKind, particleMotion } from './particles.ts';
import type { Family, Mix, ParticleKind } from './particles.ts';
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
  BannerKind,
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
type Giant = Rules['bosses'][number] | Rules['higgs'];
type Member = Omit<Target, 'id' | 'x' | 'y' | 'born' | 'maxHp'>;
type Shared = { speed: number; turn: number };
export type Choice = { cards: Card[]; number: number };
// A formation shown as faint dots until `time`; wave formations wait for their wave.
export type Pending = { planned: number; time: number; members: Member[]; wave?: number };
type Wave = { time: number; angle: number; scale: number };

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
  pending: Pending[] = [];
  waves: Wave[];
  waveCount = 0;
  rushSpawns = 0;
  banner: { kind: BannerKind; until: number; boss?: BossKind } | null = null;
  bossCount = 0;
  bossesDown = 0;
  // Ended bosses + 1; a later boss that ends first waits for the earlier one.
  round = 1;
  effects: Effect[] = [];
  damageNumbers: DamageNumber[] = [];
  events: Event[] = [];
  eventOffset = 0;
  inputs: Input[] = [];
  result: Result | null = null;
  collisionTime = 0;
  private readonly recordEvents: boolean;
  private readonly random: Record<'spawn' | 'cards' | 'rarity' | 'crit', Random>;
  outcome: Outcome = 'collapse-failure';
  trigger: Result['trigger'] = 'gravity';
  private nextSpawn = 0;
  private plannedWave = -1;
  private kills: { tick: number; energy: number }[] = [];
  private killEnergy = 0;
  private rushUntil = 0;
  private bossOrder: number[] = [];
  private bossesEnded = new Set<number>();
  private criticalEntered = false;
  private finalEntered = false;
  private finalDown = false;
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
    };
    const angles = stream('wave'),
      late = this.rules.late;
    this.waves = this.rules.stages
      .filter((s) => s.wave > 0)
      .map((s) => ({ time: s.start, angle: angles.next() * TAU, scale: s.wave }));
    // Repeats follow the listed waves every `late.waveRepeatSeconds`.
    const last = this.waves.at(-1)!;
    for (let i = 1; last && i <= 60; i++)
      this.waves.push({
        time: last.time + i * late.waveRepeatSeconds,
        angle: (last.angle + i * goldenAngle) % TAU,
        scale: late.waveScale,
      });
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
  // Critical breach pulls the orbit inward by `critical.pull`.
  get targetRadius(): number {
    const radius = orbitTarget(this.mass, this.rules);
    return this.critical ? Math.max(0, radius - this.rules.critical.pull) : radius;
  }
  get critical(): boolean {
    return this.time >= this.rules.critical.time;
  }
  // How far the run is toward the Higgs particle's arrival, from 0 to 1.
  get finalProgress(): number {
    return Math.min(1, this.time / this.rules.higgs.time);
  }
  get boss(): Target | undefined {
    return this.targets.find((t) => t.final) ?? this.targets.find((t) => t.kind === 'boss');
  }
  // Late particles grow tougher and faster by the minute after the last stage starts.
  get enemyStrength(): { hp: number; speed: number } {
    const late = this.rules.late,
      minutes = Math.max(0, (this.time - this.rules.stages.at(-1)!.start) / 60);
    const hp = 1 + minutes * late.hpPerMinute,
      speed = Math.min(late.maxSpeedScale, 1 + minutes * late.speedPerMinute);
    const c = this.rules.critical;
    return this.critical ? { hp: hp * c.hpScale, speed: speed * c.speedScale } : { hp, speed };
  }
  // After the last stage starts, each wave cycle opens with an assault, then a lull.
  get wavePhase(): 'steady' | 'assault' | 'recovery' {
    const late = this.rules.late,
      age = this.time - this.rules.stages.at(-1)!.start;
    if (age < 0) return 'steady';
    const at = age % late.waveRepeatSeconds;
    if (at < late.assaultSeconds) return 'assault';
    return at < late.assaultSeconds + late.recoverySeconds ? 'recovery' : 'steady';
  }
  get rushing(): boolean {
    return (
      this.phase === 'running' &&
      this.wavePhase !== 'recovery' &&
      this.tick < this.rushUntil &&
      this.targets.length < this.staged((s) => s.rush.maxTargets)
    );
  }
  get upcomingWave(): Wave | undefined {
    return this.waves[this.waveCount];
  }
  get warningWave(): Wave | null {
    const wave = this.upcomingWave;
    return this.phase === 'running' &&
      this.combatEnabled &&
      wave &&
      wave.time - this.time <= this.rules.spawn.waveWarningSeconds
      ? wave
      : null;
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
  // Slots grow as giant particles fall (`growth.slotKills`).
  get skillSlots(): number {
    const g = this.rules.growth;
    return g.skillSlots + g.slotKills.filter((kills) => this.bossesDown >= kills).length;
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
    if (this.finalDown) return this.beginCollapse('boss');
    this.enterMilestones();
    if (this.combatEnabled) this.spawn();
    this.moveTargets();
    this.bossActions();
    this.angle += this.rules.orbit.speed / this.radius / this.rules.time.tickRate;
    this.combat.update();
    if (this.finalDown) return this.beginCollapse('boss');
    if (this.absorbTargets()) return this.beginCollapse('boss-absorbed');
    // A giant particle on the field feeds the core.
    const boss = this.boss;
    if (
      boss &&
      this.tick % Math.round(this.giant(boss).feedSeconds * this.rules.time.tickRate) === 0
    )
      this.mass++;
    this.updateOrbit();
    if (this.margin <= 0) this.beginCollapse('gravity');
  }

  private spawn(): void {
    const tickRate = this.rules.time.tickRate;
    if (this.tick + 1e-8 >= this.nextSpawn) {
      const rushing = this.rushing;
      this.spawnBatch();
      if (rushing) this.log('rush', { count: ++this.rushSpawns });
      this.nextSpawn +=
        this.staged((s) => (rushing ? s.rush.spawnSeconds : s.spawnSeconds)) *
        tickRate *
        (this.wavePhase === 'recovery' ? this.rules.late.recoverySpawnScale : 1) *
        (this.critical ? this.rules.critical.spawnScale : 1) *
        (1 + this.random.spawn.spread() * this.rules.spawn.variation.intervalFraction);
    }
    const wave = this.upcomingWave;
    if (
      wave &&
      this.plannedWave !== this.waveCount &&
      this.time + 1e-8 >= wave.time - this.rules.formations.previewSeconds
    ) {
      this.plannedWave = this.waveCount;
      this.planWave(wave);
    }
    if (wave && this.time >= wave.time) {
      const index = this.pending.findIndex((p) => p.wave === this.waveCount);
      if (index !== -1) this.place(this.pending.splice(index, 1)[0].members);
      this.log('wave', { number: ++this.waveCount, angle: wave.angle });
    }
    const ready = this.pending.filter((p) => p.wave === undefined && this.time + 1e-8 >= p.time);
    if (!ready.length) return;
    this.pending = this.pending.filter((p) => !ready.includes(p));
    for (const p of ready) this.place(p.members);
  }

  // Waves always come as formations from two sides, planned while their warning shows.
  private planWave(wave: Wave): void {
    const cfg = this.rules.spawn,
      small = Math.round((cfg.waveSmall / 2) * wave.scale),
      dense = Math.round((cfg.waveDense / 2) * wave.scale),
      stage = this.stageAt(wave.time),
      shapes = formationsAt(wave.time, this.rules.formations),
      shape = this.random.spawn.pick(shapes);
    let members: Member[];
    if (shape === 'ring')
      members = this.formation('ring', small * 2, dense * 2, wave.angle, 1, stage);
    else {
      const [first, second] = shape === 'pincer' ? this.pincerSides(shapes) : [shape, shape];
      members = [
        ...this.formation(first, small, dense, wave.angle, 1, stage),
        ...this.formation(second, small, dense, wave.angle + Math.PI, -1, stage),
      ];
    }
    this.pending.push({ planned: this.time, time: wave.time, members, wave: this.waveCount });
    this.log('formation', { shape, wave: this.waveCount + 1, count: members.length });
  }

  // A pincer sends two shapes, never rings, from opposite sides.
  private pincerSides(shapes: readonly FormationId[]): [Shape, Shape] {
    const sides = shapes.filter((id): id is Shape => id !== 'pincer' && id !== 'ring');
    return [this.random.spawn.pick(sides), this.random.spawn.pick(sides)];
  }

  private stageAt(time: number): number {
    return this.rules.stages.filter((s) => time >= s.start).length - 1;
  }

  private get mix(): Mix {
    const assault = this.wavePhase === 'assault',
      late = this.rules.late;
    return {
      muon: assault ? late.muonProbability : this.ramped((s) => s.shares.muon),
      neutrino: this.ramped((s) => s.shares.neutrino),
      meson: this.ramped((s) => s.shares.meson),
      neutron: assault ? late.neutronProbability : this.ramped((s) => s.shares.neutron),
    };
  }

  private giant(target: Target): Giant {
    return this.rules.bosses.find((b) => b.kind === target.boss) ?? this.rules.higgs;
  }

  // Bosses keep their times even while an earlier one is still alive.
  private enterMilestones(): void {
    const next = this.rules.bosses[this.bossCount];
    if (next && this.time >= next.time) {
      this.bossCount++;
      this.addBoss(next, next.kind, 'boss');
    } else if (!next && !this.finalEntered && this.time >= this.rules.higgs.time) {
      this.finalEntered = true;
      this.addBoss(this.rules.higgs, 'higgs', 'final-boss');
      this.log('charged', { time: this.time });
    }
    if (!this.criticalEntered && this.critical) {
      this.criticalEntered = true;
      this.log('critical', { time: this.time });
      this.banner = { kind: 'critical', until: this.time + this.rules.time.bannerSeconds };
    }
  }

  private addBoss(giant: Giant, kind: BossKind, banner: BannerKind, scale = 1): void {
    const theta = this.random.spawn.next() * TAU,
      radius = this.rules.orbit.spawnRadius,
      hp = Math.round(giant.hp * this.enemyStrength.hp),
      reward = 'xp' in giant ? giant : { xp: 0, mass: 0 };
    const target: Target = {
      id: this.nextId++,
      ...orbit(theta, radius),
      angle: theta,
      radius,
      kind: 'boss',
      boss: kind,
      particle: 'neutron',
      born: this.time,
      hp,
      maxHp: hp,
      xp: reward.xp * scale,
      mass: reward.mass * scale,
      speed: giant.speed,
      turn: giant.turn,
      size: giant.size,
      summonCount: giant.summonCount,
      ...(kind === 'higgs' && { final: true }),
    };
    this.targets.push(target);
    this.bossOrder.push(target.id);
    this.banner = { kind: banner, until: this.time + this.rules.time.bannerSeconds, boss: kind };
    this.log(banner, { id: target.id, hp, boss: kind });
    if (kind === 'gluon') {
      const b = (giant as Rules['bosses'][number]).behavior;
      this.spawnAround(target, 'quark', b.tethered, b.distance, target);
    }
  }

  // Giant particle rules that act on their surroundings, once per tick.
  private bossActions(): void {
    const tickRate = this.rules.time.tickRate;
    for (const boss of this.targets.filter((t) => t.boss)) {
      const age = this.time - boss.born,
        ticks = Math.round(age * tickRate),
        giant = this.giant(boss),
        b = 'behavior' in giant ? giant.behavior : {};
      if (boss.boss === 'w') {
        // The W boson turns nearby quarks into dashing muons.
        if (ticks <= 0 || ticks % Math.round(b.seconds * tickRate)) continue;
        const near = this.targets
          .filter((t) => t.particle === 'quark' && t.tether === undefined)
          .map((t) => ({ t, d: distance(t, boss) }))
          .filter(({ d }) => d <= b.radius)
          .sort((x, y) => x.d - y.d || x.t.id - y.t.id)
          .slice(0, b.count);
        for (const { t } of near) {
          t.particle = 'muon';
          t.born = this.time;
        }
        if (!near.length) continue;
        this.addEffect({
          kind: 'convert',
          from: boss,
          to: boss,
          radius: b.radius,
          width: 1,
          life: 0.5,
          particle: 'muon',
        });
        this.log('convert', { id: boss.id, ids: near.map(({ t }) => t.id) });
      } else if (boss.boss === 'tau') {
        // The tau drops muons as each dash ends.
        if (
          ticks > 0 &&
          this.bossPhase(boss, -1 / tickRate)!.dashing &&
          !this.bossPhase(boss)!.dashing
        )
          this.spawnAround(boss, 'muon', b.drops, boss.size + 4);
      } else if (boss.boss === 'higgs') {
        // Particles inside the Higgs field slow down but grow tougher and heavier.
        const field = this.higgsField(boss),
          cfg = this.rules.higgs.field;
        for (const t of this.targets) {
          if (t.boss || t.higgs || distance(t, boss) > field) continue;
          t.higgs = true;
          t.speed *= cfg.speed;
          t.hp *= cfg.hp;
          t.maxHp *= cfg.hp;
          t.mass *= cfg.mass;
        }
      }
    }
  }

  higgsField(boss: Target): number {
    const cfg = this.rules.higgs.field;
    return boss.hp / boss.maxHp < cfg.wideFraction ? cfg.wideRadius : cfg.radius;
  }

  bossPhase(target: Target, offset = 0) {
    if (!target.boss) return undefined;
    const giant = this.giant(target);
    return bossPhase(
      target.boss,
      this.time + offset - target.born,
      'behavior' in giant ? giant.behavior : {},
    );
  }

  // Members ringed around a particle; tethered ones travel with it.
  private spawnAround(
    center: Target,
    particle: ParticleKind,
    count: number,
    spread: number,
    tether?: Target,
  ): void {
    const family = this.rules.particles[particle].family;
    const members = Array.from({ length: count }, (_, i) => {
      const a = (i * TAU) / count + center.id,
        x = center.x - CENTER.x + spread * Math.cos(a),
        y = center.y - CENTER.y + spread * Math.sin(a);
      const member = this.member(
        family,
        Math.atan2(y, x),
        Math.hypot(x, y),
        Math.sign(center.turn) || 1,
        {
          particle,
          shared: tether && { speed: tether.speed, turn: tether.turn },
        },
      );
      if (tether) member.tether = tether.id;
      return member;
    });
    this.place(members);
  }

  private endBoss(id: number): void {
    this.bossesEnded.add(id);
    while (this.bossesEnded.has(this.bossOrder[this.round - 1])) {
      this.round++;
      this.log('round', { round: this.round, time: this.time });
    }
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
      v = cfg.variation,
      shapes = this.rules.formations;
    const roll = r.next(),
      angle = r.next() * TAU,
      direction = r.next() < 0.5 ? -1 : 1;
    const intro = this.batches < cfg.introBatches;
    const smallChance =
      this.wavePhase === 'assault'
        ? this.rules.late.smallBatchProbability
        : this.ramped((s) => s.smallChance);
    const family: Family = intro || roll < smallChance ? 'small' : 'dense';
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
    const available = formationsAt(this.time, shapes);
    if (intro || !available.length || count < shapes.minCount || r.next() >= shapes.chance)
      return this.spawnGroup(family, count, center, direction);
    // Sometimes a batch arrives as a formation, shown first as faint dots.
    const shape = r.pick(available),
      small = family === 'small' ? count : 0,
      dense = family === 'dense' ? count : 0;
    let members: Member[];
    if (shape === 'pincer') {
      const [first, second] = this.pincerSides(available);
      members = [
        ...this.formation(first, Math.ceil(small / 2), Math.ceil(dense / 2), center, direction),
        ...this.formation(
          second,
          Math.floor(small / 2),
          Math.floor(dense / 2),
          center + Math.PI,
          -direction,
        ),
      ];
    } else members = this.formation(shape, small, dense, center, direction);
    this.pending.push({ planned: this.time, time: this.time + shapes.previewSeconds, members });
    this.log('formation', { shape, count: members.length });
  }

  // One shape of members that share speed and turn, so it holds until it pops.
  private formation(
    shape: Shape,
    small: number,
    dense: number,
    angle: number,
    direction: number,
    stage = this.stage,
  ): Member[] {
    const cfg = this.rules.formations,
      p = this.rules.particles,
      hp = this.rules.stages[stage].hp;
    if (shape === 'ring') {
      small = Math.round(small * cfg.ring.scale);
      dense = Math.round(dense * cfg.ring.scale);
    }
    if (shape === 'arrow' && !dense && small > 3) {
      // An arrowhead is led by one large particle worth the small ones it replaces.
      small -= Math.min(small - 3, Math.round(hp.dense / hp.small));
      dense = 1;
    }
    const kinds: Family[] =
      shape === 'ring'
        ? interleave(dense, small)
        : [...Array<Family>(dense).fill('dense'), ...Array<Family>(small).fill('small')];
    const slots = formationSlots(shape, kinds.length, angle, this.rules.orbit.spawnRadius, cfg);
    const base = (family: Family) => p[familyBase[family]];
    const shared = {
      speed:
        Math.min(...kinds.map((k) => base(k).speed)) *
        this.enemyStrength.speed *
        (shape === 'clump' ? cfg.clump.speed : 1),
      turn: shape === 'line' || shape === 'star' ? 0 : base(kinds[0] ?? 'small').turn * direction,
    };
    return kinds.map((family, i) =>
      this.member(family, slots[i].theta, slots[i].radius, direction, { shared, stage }),
    );
  }

  // Small particles come in tight packs along the arc; dense ones at even gaps.
  private spawnGroup(
    family: Family,
    count: number,
    angle: number,
    direction: number,
    origin = this.rules.orbit.spawnRadius,
  ): void {
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
          origin + r.next() * cfg.variation.radiusSpread,
          direction,
        ),
      ),
    );
  }

  // The species is drawn from the stage's mix unless given; `shared` keeps a
  // formation or a tether moving together; species scale from their family.
  private member(
    family: Family,
    angle: number,
    radius: number,
    direction: number,
    {
      particle,
      shared,
      stage = this.stage,
    }: { particle?: ParticleKind; shared?: Shared; stage?: number } = {},
  ): Member {
    particle ??= particleKind(family, this.random.spawn.next(), this.mix);
    const p = this.rules.particles[particle],
      base = this.rules.particles[familyBase[family]],
      strength = this.enemyStrength;
    const speed =
      shared?.speed ??
      base.speed *
        strength.speed *
        (1 + this.random.spawn.spread() * this.rules.spawn.variation.speedFraction);
    return {
      kind: family,
      particle,
      angle,
      radius,
      hp: Math.round(this.staged((s) => s.hp[family], stage) * p.hp * strength.hp),
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
      const motion = particleMotion(this.rules.particles[t.particle], this.time - t.born),
        boss = this.bossPhase(t)?.speed ?? 1;
      t.radius = Math.max(0, t.radius - (t.speed * motion.speed * boss) / tickRate);
      t.angle += (t.turn * motion.turn) / tickRate;
      Object.assign(t, orbit(t.angle, t.radius));
    }
  }

  // Missed particles feed the core; reports whether the final boss reached it.
  private absorbTargets(): boolean {
    const core = this.core,
      absorbed = this.targets
        .filter((t) => t.hp > 0 && t.radius <= core + t.size)
        .sort((a, b) => a.id - b.id);
    for (const t of absorbed) {
      this.mass += t.mass;
      if (t.kind === 'boss') {
        this.log('boss-absorbed', { id: t.id, mass: this.mass });
        this.endBoss(t.id);
      }
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
    const change = this.targetRadius - this.radius,
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
    if (this.bossPhase(target)?.immune) return;
    // The gluon shrugs off most damage while it still holds quarks.
    if (target.boss === 'gluon' && this.targets.some((t) => t.tether === target.id))
      damage *= (this.giant(target) as Rules['bosses'][number]).behavior.damageScale;
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp < 1e-8) target.hp = 0;
    if (target.kind === 'boss') this.summonEscorts(target);
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
        (target.final ? 54 : target.kind === 'boss' ? 36 : target.kind === 'dense' ? 11 : 6) *
        (style === 'burst' ? this.rules.combat.pops.burst.debris : 1),
      width: damage,
      life: 0.4 + delay,
      particle: target.particle,
      ...(target.boss && { boss: target.boss }),
      delay,
    });
    // A meson splits into quarks as it pops.
    const split = this.rules.particles[target.particle].split;
    if (split && target.kind !== 'boss') this.spawnAround(target, 'quark', split, 3);
    const previous = this.level;
    this.gainXp(target.xp);
    if (target.kind === 'boss') this.endBoss(target.id);
    if (target.final) {
      this.finalDown = true;
      this.log('final-boss-down', { id: target.id });
    } else if (target.kind === 'boss') {
      const slots = this.skillSlots;
      this.bossesDown++;
      this.banner = {
        kind: this.skillSlots > slots ? 'slot-open' : 'boss-down',
        until: this.time + this.rules.time.bannerSeconds,
        boss: target.boss,
      };
      this.log('boss-down', { id: target.id, slots: this.skillSlots });
    }
    this.recordKillEnergy(target.xp);
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

  // Kills that come fast enough start a rush: batches arrive quicker for a while.
  private recordKillEnergy(energy: number): void {
    const rush = this.rules.spawn.rush,
      window = rush.windowSeconds * this.rules.time.tickRate;
    this.kills.push({ tick: this.tick, energy });
    this.killEnergy += energy;
    let expired = 0;
    while (expired < this.kills.length && this.tick - this.kills[expired].tick >= window)
      this.killEnergy -= this.kills[expired++].energy;
    if (expired) this.kills.splice(0, expired);
    if (this.killEnergy < rush.energyThreshold) return;
    this.rushUntil = this.tick + window;
    if (this.rushing)
      this.nextSpawn = Math.min(
        this.nextSpawn,
        this.tick + this.staged((s) => s.rush.spawnSeconds) * this.rules.time.tickRate,
      );
  }

  private summonEscorts(boss: Target): void {
    const fractions = this.giant(boss).summonFractions;
    boss.summons ??= 0;
    while (boss.summons < fractions.length && boss.hp / boss.maxHp <= fractions[boss.summons]) {
      boss.summons++;
      // The top quark splits into a swarm of mesons instead of calling quarks.
      if (boss.boss === 'top') this.spawnAround(boss, 'meson', boss.summonCount!, boss.size + 8);
      else this.spawnGroup('small', boss.summonCount!, boss.angle, 1, boss.radius);
    }
  }

  private gainXp(amount: number): void {
    const scale = this.critical ? this.rules.critical.xpScale : 1,
      gained = amount * scale + this.xpRemainder,
      whole = Math.floor(gained + 1e-8);
    this.xpRemainder = Math.max(0, gained - whole);
    this.xp += whole;
  }

  private beginCollapse(trigger: 'gravity' | 'boss-absorbed' | 'boss'): void {
    this.outcome = trigger === 'boss' ? 'success' : 'collapse-failure';
    this.trigger = trigger;
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
      round: this.round,
      trigger: this.trigger,
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
