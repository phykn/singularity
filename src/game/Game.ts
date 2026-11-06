import type { PopStyle, SkillValues } from './skills.ts';
import { popStyles, skillValues } from './skills.ts';
import { Random } from './random.ts';
import {
  particleIds,
  particleKind,
  particleMix,
  particleMotion,
  rampedShare,
} from './particles.ts';
import { bossPhase } from './bosses.ts';
import type { BossKind } from './bosses.ts';
import { formationSlots, formationsAt, interleave } from './formations.ts';
import type { FormationId } from './formations.ts';
import type { ParticleKind } from './particles.ts';
import { eligibleUpgrades, makeCards } from './growth.ts';
import { CENTER, clamp, distance, goldenAngle, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import {
  blankBoosts,
  blankRanks,
  blankRarities,
  coreRadius,
  evolutionChance,
  isPact,
  isSkill,
  isStat,
  levelForXp,
  orbitTarget,
  pactIds,
  powerScale,
  rarityIds,
  rangeScale,
  recoveryMass,
  rollRarity,
  rules,
  skillIds,
  xpForLevel,
} from './rules.ts';
import type { Card, PactId, RuleSet, SkillId, UpgradeId } from './rules.ts';

import { Combat } from './combat.ts';
import type { Attack, Pop } from './combat.ts';
import { damageNumberSeconds, maxDamageNumbers } from './rules.ts';
import type {
  BannerKind,
  Choice,
  Count,
  DamageNumber,
  Effect,
  EffectInput,
  Event,
  Member,
  Metrics,
  Outcome,
  PendingSpawn,
  Phase,
  Result,
  Selection,
  Target,
} from './types.ts';

const blankCounts = () =>
  Object.fromEntries(
    particleIds.map((id) => [id, { generated: 0, killed: 0, absorbed: 0 }]),
  ) as Record<ParticleKind, Count>;

export class Game {
  readonly rules: RuleSet;
  seed: number;
  phase: Phase = 'ready';
  tick = 0;
  elapsedTicks = 0;
  phaseTicks = 0;
  xp = 0;
  mass = 0;
  radius: number;
  angle = -Math.PI / 2;
  startAngle = this.angle;
  pendingTicks = 0;
  ranks = blankRanks();
  boosts = blankBoosts();
  rarities = blankRarities();
  evolved: Partial<Record<SkillId, boolean>> = {};
  pacts: Partial<Record<PactId, boolean>> = {};
  score = 0;
  rushSpawns = 0;
  private kills: { tick: number; energy: number }[] = [];
  private killHead = 0;
  private killEnergy = 0;
  private rushUntil = 0;
  targets: Target[] = [];
  pending: PendingSpawn[] = [];
  private plannedWave = -1;
  effects: Effect[] = [];
  damageNumbers: DamageNumber[] = [];
  choice: Choice | null = null;
  selections: Selection[] = [];
  resonances: { tick: number; selectionCount: number; beat: 0 | 1 | 2 | 3 }[] = [];
  waves: { time: number; angle: number }[];
  waveCount = 0;
  result: Result | null = null;
  clearResult: Result | null = null;
  continuedAt: number | null = null;
  manualPaused = false;
  hiddenPaused = false;
  counts = blankCounts();
  events: Event[] = [];
  eventOffset = 0;
  notice: UpgradeId | '' = '';
  noticeUntil = 0;
  readonly combat: Combat;
  combatEnabled: boolean;
  collisionTime = 0;
  private endTrigger: Result['trigger'] = 'gravity';
  metrics: Metrics;
  private randomSpawn: Random;
  private randomCards: Random;
  private randomRarity: Random;
  private randomCrit: Random;
  private nextHorizon = 0;
  private nextSpawn = 0;
  private batchCount = 0;
  private nextTargetId = 0;
  private nextDamageId = 0;
  private orbitRecovery = 0;
  private criticalEntered = false;
  bossCount = 0;
  bossesDown = 0;
  // Each round ends with its boss; later bosses may end first but wait their turn.
  round = 1;
  // Endless seconds at which the current endless round's progress began.
  private roundFrom = 0;
  private bossOrder: number[] = [];
  private bossesEnded = new Set<number>();
  private finalEntered = false;
  private finalDown = false;
  private xpRemainder = 0;
  private popTick = -1;
  // Kills already popped this tick, per style.
  private popOrder: Partial<Record<PopStyle, number>> = {};
  banner: { kind: BannerKind; until: number; boss?: BossKind } | null = null;
  private endingOutcome: Outcome = 'collapse-failure';
  private readonly recordEvents: boolean;

  constructor(
    seed: number,
    options: { combat?: boolean; rules?: RuleSet; recordEvents?: boolean } = {},
  ) {
    this.rules = options.rules ?? rules;
    this.recordEvents = options.recordEvents ?? true;
    this.radius = this.rules.orbitRadius;
    this.metrics = this.blankMetrics();
    this.seed = seed >>> 0;
    this.randomSpawn = new Random(this.seed ^ 0x9e3779b9);
    this.randomCards = new Random(this.seed ^ 0xc2b2ae35);
    this.randomRarity = new Random(this.seed ^ 0x27d4eb2f);
    this.randomCrit = new Random(this.seed ^ 0x165667b1);
    const waveRandom = new Random(this.seed ^ 0xa511e9b3);
    this.waves = this.rules.waves.map((time) => ({ time, angle: waveRandom.next() * Math.PI * 2 }));
    this.combatEnabled = options.combat ?? true;
    this.combat = new Combat(this);
  }

  get time(): number {
    return this.tick / this.rules.tickRate;
  }
  get seconds(): number {
    return this.elapsedTicks / this.rules.tickRate;
  }
  get eventCount(): number {
    return this.eventOffset + this.events.length;
  }
  get level(): number {
    return levelForXp(this.xp, this.rules);
  }
  get speed(): number {
    return this.rules.baseSpeed;
  }
  get reach(): number {
    return rangeScale(this.boosts.range, this.rules);
  }
  get range(): number {
    return this.rules.primaryRange * this.reach;
  }
  // Skill slots grow as giant particles fall (`boss.slotKills`).
  get skillSlots(): number {
    return (
      this.rules.skillSlots +
      this.rules.boss.slotKills.filter((kills) => this.bossesDown >= kills).length
    );
  }
  get recoverable(): boolean {
    return this.mass >= this.rules.recovery.minMass && !this.pacts.overclock;
  }
  get damage(): number {
    return this.rules.baseHitDamage * powerScale(this.boosts.power, this.rules);
  }
  get rate(): number {
    return (1 + this.rules.ratePerRank * this.boosts.rate) * this.combat.heatScale;
  }
  get forms(): SkillValues {
    return skillValues(this.ranks, this.rarities, this.rules, this.reach);
  }
  get rushing(): boolean {
    return (
      this.phase === 'running' &&
      this.wavePhase !== 'recovery' &&
      this.tick < this.rushUntil &&
      this.targets.length < this.staged(this.rules.rush.maxTargetsByStage)
    );
  }
  get attackInterval(): number {
    return this.rules.attackBaseSeconds / this.rate;
  }
  get core(): number {
    return coreRadius(this.mass, this.rules);
  }
  get targetRadius(): number {
    const radius = orbitTarget(this.mass, this.rules);
    return this.critical ? Math.max(0, radius - this.rules.critical.pull) : radius;
  }
  get margin(): number {
    return this.radius - this.core - this.rules.electronRadius;
  }
  // How far the run is toward the final boss's arrival time, from 0 to 1.
  get finalProgress(): number {
    return Math.min(1, this.time / this.rules.boss.final.time);
  }
  get critical(): boolean {
    return !this.endless && this.time >= this.rules.critical.time;
  }
  get boss(): Target | undefined {
    return (
      this.targets.find((target) => target.final) ??
      this.targets.find((target) => target.kind === 'boss')
    );
  }
  get endless(): boolean {
    return this.clearResult !== null;
  }
  get endlessSeconds(): number {
    return this.clearResult
      ? Math.max(0, this.tick - Math.round(this.clearResult.collisionTime * this.rules.tickRate)) /
          this.rules.tickRate
      : 0;
  }
  get canContinue(): boolean {
    return this.phase === 'result' && this.result?.outcome === 'success' && !this.endless;
  }
  get enemyStrength(): { hp: number; speed: number } {
    const minutes = Math.max(
      0,
      ((this.clearResult?.collisionTime ?? this.time) - this.rules.stageStarts.at(-1)!) / 60,
    );
    const hp = 1 + minutes * this.rules.late.hpPerMinute;
    const speed = Math.min(
      this.rules.late.maxSpeedScale,
      1 + minutes * this.rules.late.speedPerMinute,
    );
    if (!this.endless) {
      const { hpScale, speedScale } = this.rules.critical;
      return this.critical ? { hp: hp * hpScale, speed: speed * speedScale } : { hp, speed };
    }
    const steps = this.endlessRounds,
      cfg = this.rules.endless;
    return {
      hp: Math.min(1e100, hp * cfg.roundHpMultiplier ** Math.min(1000, steps)),
      speed: speed * Math.min(cfg.maxSpeedScale, 1 + steps * cfg.roundSpeedStep),
    };
  }
  // Endless rounds finished so far; each one steps the difficulty up once.
  private get endlessRounds(): number {
    return Math.max(0, this.round - this.rules.boss.stages.length - 2);
  }
  get paused(): boolean {
    return this.manualPaused || this.hiddenPaused;
  }
  // Evolution first, a pact only while the orbit is safe, then early attack upgrades,
  // then the highest rarity.
  get automaticCard(): Card | undefined {
    const safe = this.margin > this.rules.autoPactMargin;
    const cards =
      this.choice?.cards.filter((card) => this.canUpgrade(card.id) && (safe || !isPact(card.id))) ??
      [];
    return (
      cards.find((card) => card.evolve) ??
      cards.find((card) => isPact(card.id)) ??
      cards.find(
        ({ id }) => (id === 'power' || id === 'rate') && this.boosts[id] < this.rules.autoStatRank,
      ) ??
      cards.reduce<Card | undefined>(
        (a, b) => (!a || rarityIds.indexOf(b.rarity) > rarityIds.indexOf(a.rarity) ? b : a),
        undefined,
      )
    );
  }
  canUpgrade(id: UpgradeId): boolean {
    const card = this.choice?.cards.find((entry) => entry.id === id);
    if (card?.evolve) return !this.evolved[id as SkillId];
    if (isPact(id)) return !!card && !this.pacts[id] && this.pactCount < this.rules.pacts.max;
    return eligibleUpgrades(this.ranks, this.rules, this.recoverable, this.skillSlots).includes(id);
  }
  get position(): Point {
    return orbit(this.angle, this.radius);
  }
  get stage(): number {
    return this.stageAt(this.time);
  }
  get wavePhase(): 'steady' | 'assault' | 'recovery' {
    if (this.endless) {
      const cycle =
        (this.endlessSeconds % this.rules.endless.cycleSeconds) - this.rules.waveWarningSeconds;
      if (cycle < 0) return 'steady';
      if (cycle < this.rules.endless.assaultSeconds) return 'assault';
      if (cycle < this.rules.endless.assaultSeconds + this.rules.endless.recoverySeconds)
        return 'recovery';
      return 'steady';
    }
    const age = this.time - this.rules.stageStarts.at(-1)!;
    if (age < 0) return 'steady';
    const cycle = age % this.rules.waveRepeatSeconds;
    if (cycle < this.rules.late.assaultSeconds) return 'assault';
    if (cycle < this.rules.late.assaultSeconds + this.rules.late.recoverySeconds) return 'recovery';
    return 'steady';
  }
  private get nextXp(): number {
    return xpForLevel(this.level + 1, this.rules);
  }
  get levelProgress(): { current: number; required: number } {
    const previous = xpForLevel(this.level, this.rules);
    return { current: this.xp - previous, required: this.nextXp - previous };
  }
  get upcomingWave() {
    if (this.clearResult)
      return {
        time:
          this.clearResult.collisionTime +
          this.rules.waveWarningSeconds +
          this.waveCount * this.rules.endless.cycleSeconds,
        angle: (this.waves.at(-1)!.angle + this.waveCount * goldenAngle) % (Math.PI * 2),
      };
    if (this.waveCount < this.waves.length) return this.waves[this.waveCount];
    const last = this.waves.at(-1)!,
      repeat = this.waveCount - this.waves.length + 1;
    return {
      time: last.time + repeat * this.rules.waveRepeatSeconds,
      angle: (last.angle + repeat * goldenAngle) % (Math.PI * 2),
    };
  }
  get warningWave() {
    const wave = this.upcomingWave;
    return this.phase === 'running' &&
      wave &&
      wave.time - this.time <= this.rules.waveWarningSeconds
      ? wave
      : null;
  }
  get phaseProgress(): number {
    return (
      this.phaseTicks /
      (this.rules.tickRate *
        (this.phase === 'crossing'
          ? this.rules.endless.entrySeconds
          : this.phase === 'collapse'
            ? this.rules.collisionSeconds
            : this.successfulEnding
              ? this.rules.successEndingSeconds
              : this.rules.failureEndingSeconds))
    );
  }
  get successfulEnding(): boolean {
    return this.endingOutcome === 'success';
  }
  rank(id: UpgradeId): number {
    if (isPact(id)) return this.pacts[id] ? 1 : 0;
    return id === 'recover' ? 0 : isSkill(id) ? this.ranks[id] : this.boosts[id];
  }

  get pactCount(): number {
    return pactIds.filter((id) => this.pacts[id]).length;
  }
  // Seeded separately so critical rolls never shift spawns or cards.
  critRoll(): number {
    return this.randomCrit.next();
  }

  get ownedSkills() {
    const acquired = new Map<string, number>();
    this.selections.forEach(({ id }, idx) => {
      if (!acquired.has(id)) acquired.set(id, idx);
    });
    return skillIds
      .filter((id) => this.ranks[id] > 0)
      .sort((a, b) => (acquired.get(a) ?? -1) - (acquired.get(b) ?? -1));
  }

  start(): void {
    if (this.phase !== 'ready') return;
    this.startAngle = this.angle;
    this.phase = 'running';
    this.log('start', { seed: this.seed });
    if (this.combatEnabled) {
      this.spawnBatch();
      this.nextSpawn = this.staged(this.rules.spawnSecondsByStage) * this.rules.tickRate;
    }
  }
  continueBeyond(): boolean {
    if (!this.canContinue || this.paused) return false;
    this.clearResult = this.result;
    this.continuedAt = this.elapsedTicks;
    this.result = null;
    this.phase = 'crossing';
    this.phaseTicks = 0;
    this.pendingTicks = 0;
    this.mass = 0;
    this.radius = this.rules.orbitRadius;
    this.orbitRecovery = 0;
    this.choice = null;
    this.targets = [];
    this.pending = [];
    this.plannedWave = -1;
    this.effects = [];
    this.damageNumbers = [];
    this.notice = '';
    this.banner = null;
    this.xpRemainder = 0;
    this.finalDown = false;
    this.kills = [];
    this.killHead = this.killEnergy = this.rushUntil = 0;
    this.waveCount = this.rushSpawns = 0;
    this.batchCount = this.rules.introBatches;
    this.nextSpawn = this.tick + this.rules.waveWarningSeconds * this.rules.tickRate;
    this.counts = blankCounts();
    this.metrics = this.blankMetrics();
    this.combat.reset();
    // Endless play opens round seven, after the five giant particles and the Higgs.
    this.round = this.rules.boss.stages.length + 2;
    this.roundFrom = 0;
    this.log('beyond', { tick: this.elapsedTicks });
    return true;
  }
  private blankMetrics(): Metrics {
    return {
      minRadius: this.radius,
      minMargin: this.margin,
      dangerSeconds: 0,
      maxTargets: 0,
      maxEffects: 0,
    };
  }
  retire(): boolean {
    if (!this.endless || !['running', 'crossing'].includes(this.phase)) return false;
    this.endingOutcome = 'retired';
    this.endTrigger = 'quit';
    this.collisionTime = this.time;
    this.choice = null;
    this.combat.clear();
    this.finishResult();
    return true;
  }
  setManualPause(paused: boolean): void {
    this.manualPaused = paused;
  }
  setHidden(paused: boolean): void {
    this.hiddenPaused = paused;
  }

  advance(
    milliseconds: number,
    tickLimit = Infinity,
    {
      choiceMilliseconds = milliseconds,
      stopAtChoice = false,
      autoSelect = true,
      beforeCombat,
    }: {
      choiceMilliseconds?: number;
      stopAtChoice?: boolean;
      autoSelect?: boolean;
      beforeCombat?: () => void;
    } = {},
  ): void {
    if (this.paused || this.phase === 'ready' || this.phase === 'result') return;
    this.pendingTicks += (milliseconds * this.rules.tickRate) / 1000;
    const count =
      stopAtChoice && this.choice ? 0 : Math.min(Math.floor(this.pendingTicks + 1e-8), tickLimit);
    this.pendingTicks -= count;
    // Keep the unscaled choice countdown relative to the combat time actually advanced.
    if (this.choice)
      this.choice.deadline += count / this.rules.tickRate - choiceMilliseconds / 1000;
    for (let i = 0; i < count && !this.result; i++) {
      if (stopAtChoice && this.choice) {
        this.pendingTicks = 0;
        break;
      }
      this.elapsedTicks++;
      if (this.phase === 'running') this.step(autoSelect, beforeCombat);
      else {
        this.phaseTicks++;
        if (this.phaseProgress >= 1) {
          this.phaseTicks = 0;
          if (this.phase === 'crossing') {
            this.phase = 'running';
            this.log('beyond-ready', {});
          } else if (this.phase === 'collapse') {
            this.phase = 'ending';
            this.log('ending', this.endingOutcome);
          } else this.finishResult();
        }
      }
      this.expireEffects();
    }
    if (stopAtChoice && this.choice) this.pendingTicks = 0;
    if (autoSelect) this.selectAtDeadline(false);
  }

  // Unpaused choices pick themselves once their time runs out.
  private selectAtDeadline(beforeCombat: boolean): void {
    if (!this.choice || this.time + 1e-8 < this.choice.deadline) return;
    const card = this.automaticCard;
    if (card) this.select(card.id, true, this.choice.number, beforeCombat);
  }

  expireEffects(): void {
    this.effects = this.effects.filter((fx) => this.seconds < fx.born + fx.life);
    this.damageNumbers = this.damageNumbers.filter(
      (damage) => this.seconds < damage.born + damageNumberSeconds,
    );
  }

  private step(autoSelect: boolean, beforeCombat?: () => void): void {
    this.tick++;
    if (this.finalDown) {
      this.beginCollapse('boss');
      return;
    }
    beforeCombat?.();
    if (autoSelect) this.selectAtDeadline(true);
    this.enterMilestones();
    if (this.combatEnabled && this.tick + 1e-8 >= this.nextSpawn) {
      const rushing = this.rushing;
      this.spawnBatch();
      if (rushing) {
        this.rushSpawns++;
        this.log('rush', { count: this.rushSpawns });
      }
      this.nextSpawn +=
        (rushing
          ? this.staged(this.rules.rush.spawnSecondsByStage)
          : this.staged(this.rules.spawnSecondsByStage)) *
        this.rules.tickRate *
        (this.wavePhase === 'recovery' ? this.rules.late.recoverySpawnScale : 1) *
        (this.critical ? this.rules.critical.spawnScale : 1) *
        (this.pacts.greed ? 1 / (1 + this.rules.pacts.greed.spawn) : 1) *
        (1 + (this.randomSpawn.next() * 2 - 1) * this.rules.spawnVariation.intervalFraction);
    }
    const wave = this.upcomingWave;
    if (
      wave &&
      this.combatEnabled &&
      this.plannedWave !== this.waveCount &&
      this.time + 1e-8 >= wave.time - this.rules.formations.previewSeconds
    ) {
      this.plannedWave = this.waveCount;
      this.planWave(wave.angle, wave.time);
    }
    if (wave && this.time >= wave.time) this.spawnWave(wave.angle);
    this.releasePending();
    this.moveTargets();
    this.bossActions();
    this.angle += this.speed / this.radius / this.rules.tickRate;
    this.combat.update();
    if (this.pacts.horizon && this.combatEnabled && this.time + 1e-8 >= this.nextHorizon) {
      this.nextHorizon = this.time + this.rules.pacts.horizon.massSeconds;
      this.mass += 1;
    }
    if (this.finalDown) {
      this.beginCollapse('boss');
      return;
    }
    if (this.absorbTargets()) {
      this.beginCollapse('gravity');
      return;
    }
    if (
      this.boss &&
      this.tick % Math.round(this.rules.boss.feedSeconds * this.rules.tickRate) === 0
    )
      this.mass++;
    this.updateOrbit();
    this.metrics.minRadius = Math.min(this.metrics.minRadius, this.radius);
    this.metrics.minMargin = Math.min(this.metrics.minMargin, this.margin);
    if (this.margin > 0 && this.margin < this.rules.dangerMargin)
      this.metrics.dangerSeconds += 1 / this.rules.tickRate;
    if (this.margin <= 0) {
      this.beginCollapse('gravity');
      return;
    }
    this.openChoice();
  }

  private spawnWave(angle: number): void {
    const index = this.pending.findIndex((p) => p.wave === this.waveCount);
    if (index !== -1) this.placeMembers(this.pending.splice(index, 1)[0].members);
    this.waveCount++;
    this.log('wave', { number: this.waveCount, angle: angle });
  }

  // Waves always come as formations, planned while their warning shows.
  private planWave(angle: number, time: number): void {
    const scale =
      this.rules.waveScale[
        this.endless
          ? this.rules.waveScale.length - 1
          : Math.min(this.waveCount, this.rules.waveScale.length - 1)
      ];
    const small = Math.round((this.rules.waveSmall / 2) * scale),
      dense = Math.round((this.rules.waveDense / 2) * scale),
      stage = this.stageAt(time);
    const shapes = formationsAt(this.endless ? Infinity : time, this.rules.formations);
    const shape = this.randomSpawn.pick(shapes);
    let members: Member[];
    if (shape === 'ring') members = this.formation('ring', small * 2, dense * 2, angle, 1, stage);
    else {
      const [first, second] = shape === 'pincer' ? this.pincerSides(shapes) : [shape, shape];
      members = [
        ...this.formation(first, small, dense, angle, 1, stage),
        ...this.formation(second, small, dense, angle + Math.PI, -1, stage),
      ];
    }
    this.pending.push({ planned: this.time, time, members, wave: this.waveCount });
    this.log('formation', { shape, wave: this.waveCount + 1, count: members.length });
  }

  // A pincer sends two shapes, never rings, from opposite sides.
  private pincerSides(shapes: readonly FormationId[]) {
    const sides = shapes.filter((id) => id !== 'pincer' && id !== 'ring');
    return [this.randomSpawn.pick(sides), this.randomSpawn.pick(sides)] as const;
  }

  private stageAt(time: number): number {
    if (this.endless) return this.rules.stageStarts.length - 1;
    return this.rules.stageStarts.filter((start) => time >= start).length - 1;
  }

  private get mix() {
    return particleMix(
      this.stage,
      this.rules.particles,
      this.wavePhase === 'assault' ? this.rules.late : undefined,
      this.stageProgress(),
    );
  }

  // A per-stage share that moves linearly from the previous stage's value over
  // the first part of the stage, like a newcomer particle's share.
  private ramped(values: readonly number[]): number {
    return rampedShare(
      values,
      this.stage,
      Math.min(1, this.stageProgress() / this.rules.particles.ramp),
    );
  }

  // How far through the current stage the run is; the last stage counts its
  // length like the one before it.
  private stageProgress(): number {
    if (this.endless) return 1;
    const stage = this.stage,
      starts = this.rules.stageStarts,
      length = (starts[stage + 1] ?? 2 * starts[stage] - starts[stage - 1]) - starts[stage];
    return clamp((this.time - starts[stage]) / length);
  }

  private enterMilestones(): void {
    if (this.endless) {
      // After each round's progress, one giant particle in turn, scaled by the difficulty.
      const stages = this.rules.boss.stages;
      if (
        this.combatEnabled &&
        this.bossOrder.length < this.round &&
        this.endlessSeconds - this.roundFrom >= this.rules.endless.roundSeconds
      )
        this.spawnBoss(
          stages[this.endlessRounds % stages.length],
          this.rules.endless.roundHpMultiplier ** this.endlessRounds,
        );
      return;
    }
    // Bosses keep their times even while an earlier one is still alive.
    const stage = this.rules.boss.stages[this.bossCount];
    if (stage && this.time >= stage.time) {
      this.bossCount++;
      if (this.combatEnabled) this.spawnBoss(stage);
    } else if (!stage && !this.finalEntered && this.time >= this.rules.boss.final.time) {
      this.finalEntered = true;
      if (this.combatEnabled) this.spawnFinalBoss();
      this.log('charged', { time: this.time });
    }
    if (!this.criticalEntered && this.critical) {
      this.criticalEntered = true;
      this.log('critical', { time: this.time });
      this.banner = { kind: 'critical', until: this.time + this.rules.bannerSeconds };
    }
  }

  // Hit points already follow enemy strength; `scale` raises the reward and the missed mass.
  private spawnBoss(stage: RuleSet['boss']['stages'][number], scale = 1): void {
    const { speed, size } = this.rules.boss,
      { hp, summonCount } = stage;
    this.addBoss(
      { hp, xp: stage.xp * scale, mass: stage.mass * scale, speed, size, summonCount },
      'boss',
      stage.kind as BossKind,
    );
  }

  private spawnFinalBoss(): void {
    const { hp, speed, size, summonCount } = this.rules.boss.final;
    this.addBoss(
      { hp, xp: 0, mass: 0, speed, size, summonCount, final: true },
      'final-boss',
      'higgs',
    );
  }

  private addBoss(
    data: Pick<Target, 'hp' | 'xp' | 'mass' | 'speed' | 'size' | 'summonCount' | 'final'>,
    banner: BannerKind,
    kind: BossKind,
  ): void {
    const theta = this.randomSpawn.next() * Math.PI * 2,
      hp = Math.round(data.hp * this.enemyStrength.hp);
    const target: Target = {
      ...data,
      id: this.nextTargetId++,
      ...orbit(theta, this.rules.spawnRadius),
      angle: theta,
      radius: this.rules.spawnRadius,
      kind: 'boss',
      boss: kind,
      particle: 'neutron',
      born: this.time,
      hp,
      maxHp: hp,
      turn: this.rules.boss.turn,
    };
    this.targets.push(target);
    this.bossOrder.push(target.id);
    this.counts.neutron.generated++;
    this.banner = { kind: banner, until: this.time + this.rules.bannerSeconds, boss: kind };
    this.log(banner, { id: target.id, hp, boss: kind });
    if (kind === 'gluon') {
      const { tethered, distance } = this.rules.boss.behaviors.gluon;
      this.spawnAround(target, 'quark', tethered, distance, target);
    }
  }

  // Giant particle rules that act on their surroundings, once per tick.
  private bossActions(): void {
    const behaviors = this.rules.boss.behaviors;
    for (const boss of this.targets.filter((t) => t.boss)) {
      const age = this.time - boss.born,
        ticks = Math.round(age * this.rules.tickRate);
      if (boss.boss === 'w') {
        const { seconds, radius, count } = behaviors.w,
          every = Math.round(seconds * this.rules.tickRate);
        if (ticks <= 0 || ticks % every) continue;
        const near = this.targets
          .filter((t) => t.particle === 'quark' && t.tether === undefined)
          .map((t) => ({ t, d: distance(t, boss) }))
          .filter(({ d }) => d <= radius)
          .sort((a, b) => a.d - b.d || a.t.id - b.t.id)
          .slice(0, count);
        for (const { t } of near) {
          t.particle = 'muon';
          t.born = this.time;
          this.counts.quark.generated--;
          this.counts.muon.generated++;
        }
        if (near.length) {
          this.addEffect({
            kind: 'convert',
            from: boss,
            to: boss,
            radius,
            width: 1,
            life: 0.5,
            particle: 'muon',
          });
          this.log('convert', { id: boss.id, ids: near.map(({ t }) => t.id) });
        }
      } else if (boss.boss === 'tau') {
        const before = bossPhase('tau', age - 1 / this.rules.tickRate, behaviors),
          now = bossPhase('tau', age, behaviors);
        if (ticks > 0 && before.dashing && !now.dashing)
          this.spawnAround(boss, 'muon', behaviors.tau.drops, boss.size + 4);
      } else if (boss.boss === 'higgs') {
        const field = this.higgsField(boss);
        for (const t of this.targets) {
          if (t.boss || t.higgs || distance(t, boss) > field) continue;
          const cfg = this.rules.boss.final.field;
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
    const cfg = this.rules.boss.final.field;
    return boss.hp / boss.maxHp < cfg.wideFraction ? cfg.wideRadius : cfg.radius;
  }

  bossPhase(target: Target) {
    return target.boss
      ? bossPhase(target.boss, this.time - target.born, this.rules.boss.behaviors)
      : undefined;
  }

  // Members ringed around a particle; tethered ones travel with it.
  private spawnAround(
    center: Target,
    particle: ParticleKind,
    count: number,
    spread: number,
    tether?: Target,
  ): void {
    const kind = particle === 'proton' || particle === 'neutron' ? 'dense' : 'small';
    const members = Array.from({ length: count }, (_, i) => {
      const a = (i * Math.PI * 2) / count + center.id,
        x = center.x - CENTER.x + spread * Math.cos(a),
        y = center.y - CENTER.y + spread * Math.sin(a);
      const member = this.member(
        kind,
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
    this.placeMembers(members);
  }

  moveTargets(): void {
    for (const target of this.targets) {
      const motion = particleMotion(target.particle, this.time - target.born),
        boss = this.bossPhase(target)?.speed ?? 1;
      target.radius = Math.max(
        0,
        target.radius - (target.speed * motion.speed * boss) / this.rules.tickRate,
      );
      target.angle += (target.turn * motion.turn) / this.rules.tickRate;
      Object.assign(target, orbit(target.angle, target.radius));
    }
  }

  private endBoss(id: number): void {
    this.bossesEnded.add(id);
    while (this.bossesEnded.has(this.bossOrder[this.round - 1])) {
      this.round++;
      this.roundFrom = this.endlessSeconds;
      this.log('round', { round: this.round, time: this.time });
    }
  }

  // Reports whether the final boss reached the core, which ends the run.
  absorbTargets(): boolean {
    const core = this.core;
    const absorbed = this.targets
      .filter((t) => t.hp > 0 && t.radius <= core + t.size)
      .sort((a, b) => a.id - b.id);
    for (const target of absorbed) {
      this.mass += target.mass;
      this.counts[target.particle].absorbed++;
      if (target.kind === 'boss') {
        this.log('boss-absorbed', { id: target.id, mass: this.mass });
        this.endBoss(target.id);
      }
      this.addEffect({
        kind: 'absorb',
        from: target,
        to: CENTER,
        radius: this.core + 10,
        width: 1,
        life: 0.5,
      });
      this.log('absorb', { id: target.id, kind: target.kind, mass: this.mass });
    }
    const ids = new Set(absorbed.map((t) => t.id));
    this.targets = this.targets.filter((t) => !ids.has(t.id) && t.hp > 0);
    return absorbed.some((t) => t.final);
  }

  releaseMass(amount: number): number {
    const removed = Math.min(this.mass, amount);
    this.mass -= removed;
    this.orbitRecovery = Math.min(
      this.rules.orbitRadius - this.radius,
      this.orbitRecovery + removed * this.rules.gravityPerMass,
    );
    return removed;
  }

  private updateOrbit(): void {
    if (this.orbitRecovery > 0) {
      const change = Math.min(
        this.orbitRecovery,
        this.rules.outwardSpeed / this.rules.tickRate,
        this.rules.orbitRadius - this.radius,
      );
      this.radius += change;
      this.orbitRecovery = Math.max(0, this.orbitRecovery - change);
      if (this.orbitRecovery < 1e-8 || this.radius >= this.rules.orbitRadius)
        this.orbitRecovery = 0;
      return;
    }
    const change = this.targetRadius - this.radius;
    this.radius +=
      Math.sign(change) *
      Math.min(
        Math.abs(change),
        (change < 0 ? this.rules.inwardSpeed : this.rules.outwardSpeed) / this.rules.tickRate,
      );
  }

  debugClear(): void {
    this.finalDown = true;
  }

  debugSetXp(xp: number): void {
    if (!['ready', 'running'].includes(this.phase)) return;
    const previous = this.level;
    this.xp = Math.max(0, Math.floor(xp));
    this.levelUp(previous);
    this.openChoice();
  }

  private levelUp(previous: number): void {
    if (this.level <= previous) return;
    this.log('level', { level: this.level, xp: this.xp });
    this.addEffect({
      kind: 'level',
      from: this.position,
      to: this.position,
      radius: 24,
      width: 1,
      life: 0.5,
    });
  }

  private openChoice(): void {
    if (this.phase !== 'running' || this.choice || this.selections.length >= this.level - 1) return;
    const number = this.selections.length + 1;
    const danger = this.margin < this.rules.dangerMargin;
    const offered: Card[] = makeCards(
      {
        ranks: this.ranks,
        boosts: this.boosts,
        number,
        danger,
        recoverable: this.recoverable,
        slots: this.skillSlots,
      },
      this.randomCards,
      this.rules,
    ).map((id) => {
      const rolled = rollRarity(this.randomRarity.next(), this.rules, this.boosts.luck);
      return { id, rarity: isStat(id) ? 'common' : this.rank(id) ? this.rarities[id] : rolled };
    });
    const evolution = this.evolutionOffer();
    const evolutions = evolution
      ? [{ id: evolution, rarity: this.rarities[evolution], evolve: true }]
      : [];
    const pact = !evolutions.length && !danger ? this.pactOffer(number) : undefined;
    if (pact) offered[offered.length - 1] = { id: pact, rarity: 'common' };
    // In danger the recovery card stays first; an evolution takes the next place.
    const lead = offered[0]?.id === 'recover' ? offered.slice(0, 1) : [];
    const cards = [...lead, ...evolutions, ...offered.slice(lead.length)].slice(
      0,
      this.rules.choiceCount,
    );
    this.choice = {
      cards,
      number,
      opened: this.time,
      deadline: (this.tick + this.rules.choiceSeconds * this.rules.tickRate) / this.rules.tickRate,
    };
    this.log('cards', { number, cards });
  }

  // While a maximum-rank skill is unevolved, each choice may offer its evolution; luck raises
  // the chance up to its maximum, and no run of misses forces one.
  private evolutionOffer(): SkillId | undefined {
    const ready = this.ownedSkills.filter(
      (id) => this.ranks[id] >= this.rules.maxRank && !this.evolved[id],
    );
    if (!ready.length) return undefined;
    if (this.randomCards.next() >= evolutionChance(this.boosts.luck, this.rules)) return undefined;
    return ready[Math.floor(this.randomCards.next() * ready.length)];
  }

  private pactOffer(number: number): PactId | undefined {
    const cfg = this.rules.pacts;
    if (
      number % cfg.interval ||
      this.ownedSkills.length < cfg.minSkills ||
      this.pactCount >= cfg.max
    )
      return undefined;
    const open = pactIds.filter((id) => !this.pacts[id]);
    return open.length ? open[Math.floor(this.randomCards.next() * open.length)] : undefined;
  }

  // Beat 0 is a missed beat; it matters only to the pulse pact.
  resonate(beat: 0 | 1 | 2 | 3): boolean {
    if (
      ![0, 1, 2, 3].includes(beat) ||
      this.phase !== 'running' ||
      this.paused ||
      this.choice ||
      this.resonances.at(-1)?.tick === this.elapsedTicks
    )
      return false;
    const input = { tick: this.elapsedTicks, selectionCount: this.selections.length, beat };
    this.resonances.push(input);
    this.log('resonance', input);
    if (beat === 0) {
      if (this.pacts.pulse) this.mass += this.rules.pacts.pulse.missMass;
      return true;
    }
    this.combat.resonate(beat);
    this.combat.sweep(beat);
    // Overclock gives up mass release, including this one.
    if (beat === 3 && !this.pacts.overclock) this.releaseMass(this.rules.resonance.finishMass);
    return true;
  }

  select(
    id: UpgradeId,
    automatic = false,
    choiceNumber = this.choice?.number,
    beforeCombat = false,
  ): boolean {
    if (
      this.paused ||
      this.phase !== 'running' ||
      !this.choice ||
      choiceNumber !== this.choice.number
    )
      return false;
    const card = this.choice.cards.find((card) => card.id === id);
    if (!card) return false;
    if (!automatic && this.time + 1e-8 >= this.choice.deadline) return false;
    if (!this.canUpgrade(id)) return false;
    const previous = this.rank(id),
      oldRate = this.rate;
    if (previous === 0 && !isStat(id)) this.rarities[id] = card.rarity;
    if (card.evolve) {
      this.evolved[id as SkillId] = true;
      this.log('evolve', { id });
    } else if (isPact(id)) this.takePact(id);
    else if (id === 'recover') {
      const removed = this.releaseMass(recoveryMass(card.rarity, this.rules));
      this.log('recover', { removed, mass: this.mass });
    } else if (isSkill(id)) this.ranks[id]++;
    else this.boosts[id]++;
    if (this.rate !== oldRate) this.combat.rescaleCooldowns(oldRate);
    const selection = {
      tick: this.elapsedTicks,
      time: this.time,
      id,
      rank: this.rank(id),
      rarity: this.rarities[id],
      automatic,
      beforeCombat,
      evolve: !!card.evolve,
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
      rarity: this.rarities[id],
      anchor: id === 'recover' ? undefined : 'electron',
    });
    this.notice = id;
    this.noticeUntil = this.time + 2;
    this.combat.learn(id, previous);
    this.choice = null;
    this.openChoice();
    return true;
  }

  private takePact(id: PactId): void {
    this.pacts[id] = true;
    if (id === 'horizon') this.nextHorizon = this.time + this.rules.pacts.horizon.massSeconds;
    this.log('pact', { id, mass: this.mass });
  }

  spawnBatch(): void {
    const roll = this.randomSpawn.next(),
      angle = this.randomSpawn.next() * Math.PI * 2,
      direction = this.randomSpawn.next() < 0.5 ? -1 : 1;
    const intro = this.batchCount < this.rules.introBatches;
    const smallProbability =
      this.wavePhase === 'assault'
        ? this.rules.late.smallBatchProbability
        : this.ramped(this.rules.smallBatchProbabilityByStage);
    const kind = intro || roll < smallProbability ? 'small' : 'dense';
    const size = kind === 'small' ? this.rules.smallBatchSize : this.rules.denseBatchSize;
    const count = intro
      ? this.rules.introBatchSize
      : Math.max(
          1,
          Math.round(
            size *
              this.staged(this.rules.batchScale) *
              (1 + (this.randomSpawn.next() * 2 - 1) * this.rules.spawnVariation.batchFraction),
          ),
        );
    const cfg = this.rules.spawnVariation,
      shapes = this.rules.formations;
    const center = intro
      ? this.angle +
        cfg.introAngleMin +
        this.randomSpawn.next() * (cfg.introAngleMax - cfg.introAngleMin)
      : angle;
    this.batchCount++;
    const available = formationsAt(this.endless ? Infinity : this.time, shapes);
    if (
      intro ||
      !available.length ||
      count < shapes.minCount ||
      this.randomSpawn.next() >= shapes.chance
    ) {
      this.spawnGroup(kind, count, center, direction);
      return;
    }
    // Sometimes a batch arrives as a formation, shown first as faint dots.
    const shape = this.randomSpawn.pick(available),
      small = kind === 'small' ? count : 0,
      dense = kind === 'dense' ? count : 0;
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
    this.pending.push({
      planned: this.time,
      time: this.time + shapes.previewSeconds,
      members,
    });
    this.log('formation', { shape, count: members.length });
  }

  // One shape of members that share speed and turn, so it holds until it pops.
  private formation(
    shape: Exclude<FormationId, 'pincer'>,
    small: number,
    dense: number,
    angle: number,
    direction: number,
    stage = this.stage,
  ): Member[] {
    const cfg = this.rules.formations,
      targets = this.rules.targets;
    if (shape === 'ring') {
      small = Math.round(small * cfg.ringScale);
      dense = Math.round(dense * cfg.ringScale);
    }
    if (shape === 'arrow' && !dense && small > 3) {
      // An arrowhead is led by one large particle worth the small ones it replaces.
      const replaced = Math.min(
        small - 3,
        Math.round(targets.dense.hp[stage] / targets.small.hp[stage]),
      );
      small -= replaced;
      dense = 1;
    }
    const kinds: ('small' | 'dense')[] =
      shape === 'ring'
        ? interleave(dense, small)
        : [...Array(dense).fill('dense'), ...Array(small).fill('small')];
    const slots = formationSlots(shape, kinds.length, angle, this.rules.spawnRadius, cfg);
    const strength = this.enemyStrength;
    const shared = {
      speed:
        Math.min(...kinds.map((k) => targets[k].speed)) *
        strength.speed *
        (shape === 'clump' ? cfg.clumpSpeed : 1),
      turn:
        shape === 'line' || shape === 'star' ? 0 : targets[kinds[0] ?? 'small'].turn * direction,
    };
    return kinds.map((kind, i) =>
      this.member(kind, slots[i].theta, slots[i].radius, direction, { shared, stage }),
    );
  }

  private spawnGroup(
    kind: 'small' | 'dense',
    count: number,
    angle: number,
    direction: number,
    origin = this.rules.spawnRadius,
  ): void {
    const cfg = this.rules.spawnVariation;
    // Small particles come in tight packs along the arc.
    const offsets: number[] = [];
    if (kind === 'small') {
      const pack = this.rules.particles.quarkPack;
      let at = 0;
      while (offsets.length < count) {
        const size =
          pack.size[0] + Math.floor(this.randomSpawn.next() * (pack.size[1] - pack.size[0] + 1));
        for (let i = 0; i < size && offsets.length < count; i++, at += pack.spacing)
          offsets.push(at);
        at += pack.gap - pack.spacing;
      }
    } else for (let i = 0; i < count; i++) offsets.push(i * 0.46);
    const middle = ((offsets.at(-1) ?? 0) + (offsets[0] ?? 0)) / 2;
    const members = offsets.map((offset) =>
      this.member(
        kind,
        angle + offset - middle + (this.randomSpawn.next() * 2 - 1) * cfg.angleJitter,
        origin + this.randomSpawn.next() * cfg.radiusSpread,
        direction,
      ),
    );
    this.placeMembers(members);
  }

  // `particle` is drawn from the stage's mix unless given; `shared` keeps a
  // formation or tether moving together.
  private member(
    kind: 'small' | 'dense',
    angle: number,
    radius: number,
    direction: number,
    {
      particle,
      shared,
      stage = this.stage,
    }: { particle?: ParticleKind; shared?: { speed: number; turn: number }; stage?: number } = {},
  ): Member {
    const data = this.rules.targets[kind],
      p = this.rules.particles,
      strength = this.enemyStrength;
    particle ??= particleKind(kind, this.randomSpawn.next(), this.mix);
    // Neutrons are the heavy dense particle, mesons the small one that splits.
    const species = particle === 'neutron' ? p.heavy : particle === 'meson' ? p.split : undefined;
    const speed =
      shared?.speed ??
      data.speed *
        strength.speed *
        (1 + (this.randomSpawn.next() * 2 - 1) * this.rules.spawnVariation.speedFraction);
    return {
      kind,
      particle,
      angle,
      radius,
      hp: Math.round(
        this.staged(this.rules.targets[kind].hp, stage) * (species?.hp ?? 1) * strength.hp,
      ),
      xp: species?.xp ?? data.xp,
      mass: species?.mass ?? data.mass,
      size: data.size,
      speed: speed * (particle === 'neutron' ? p.heavy.speed : 1),
      turn: (shared?.turn ?? data.turn * direction) * (particle === 'meson' ? p.split.turn : 1),
    };
  }

  // HP, group size and spawn pace climb geometrically through a stage toward the
  // next stage's values, so stage starts and their waves are not a sudden wall.
  private staged(values: readonly number[], stage = this.stage): number {
    const starts = this.rules.stageStarts;
    if (this.endless || stage >= values.length - 1) return values[stage];
    const progress = clamp((this.time - starts[stage]) / (starts[stage + 1] - starts[stage]));
    return values[stage] * (values[stage + 1] / values[stage]) ** progress;
  }

  private placeMembers(members: Member[]): void {
    const planned = [];
    for (const member of members) {
      if (this.endless && this.targets.length >= this.rules.endless.maxTargets) break;
      const { angle, radius, tether, ...data } = member;
      const id = this.nextTargetId++;
      const target: Target = {
        ...data,
        id,
        ...orbit(angle, radius),
        angle,
        radius,
        born: this.time,
        maxHp: data.hp,
        ...(tether !== undefined && { tether }),
        ...(data.particle === 'neutrino' && { veiled: true }),
      };
      this.targets.push(target);
      this.counts[data.particle].generated++;
      planned.push({ id, kind: data.kind, angle, hp: data.hp });
    }
    if (!planned.length) return;
    this.metrics.maxTargets = Math.max(this.metrics.maxTargets, this.targets.length);
    this.log('spawn', { planned });
  }

  // Formations that have finished showing their dots.
  private releasePending(): void {
    const ready = this.pending.filter((p) => p.wave === undefined && this.time + 1e-8 >= p.time);
    if (!ready.length) return;
    this.pending = this.pending.filter((p) => !ready.includes(p));
    for (const spawn of ready) this.placeMembers(spawn.members);
  }

  damageTarget(target: Target, damage: number, attack?: Attack, crit = false, pop?: Pop): void {
    if (target.hp <= 0) return;
    const index = this.targets.indexOf(target);
    if (index === -1) return;
    if (target.veiled) {
      target.veiled = false;
      target.hitAt = this.time;
      this.log('reveal', { id: target.id, x: target.x, y: target.y });
      return;
    }
    if (this.bossPhase(target)?.immune) return;
    if (target.boss === 'gluon' && this.targets.some((t) => t.tether === target.id))
      damage *= this.rules.boss.behaviors.gluon.damageScale;
    target.hp -= damage;
    if (target.hp < 1e-8) target.hp = 0;
    target.hitAt = this.time;
    if (target.kind === 'boss') this.summonEscorts(target);
    this.log('hit', {
      id: target.id,
      kind: target.kind,
      damage,
      x: target.x,
      y: target.y,
      ...(crit && { crit }),
    });
    this.damageNumbers.push({
      id: this.nextDamageId++,
      x: target.x,
      y: target.y,
      value: damage,
      born: this.seconds,
      ...(crit && { crit }),
    });
    if (this.damageNumbers.length > maxDamageNumbers)
      this.damageNumbers.splice(0, this.damageNumbers.length - maxDamageNumbers);
    if (target.hp <= 0) {
      if (attack && !attack.firstKill) attack.firstKill = { x: target.x, y: target.y };
      this.counts[target.particle].killed++;
      this.combat.killed(target, attack);
      this.targets.splice(index, 1);
      const style = this.popStyle(attack, pop);
      const delay = this.popDelay(style, target, pop?.from);
      this.addEffect({
        kind: 'kill',
        from: target,
        to: this.position,
        // Kills that pop all at once throw bigger debris.
        radius:
          (target.final ? 54 : target.kind === 'boss' ? 36 : target.kind === 'dense' ? 11 : 6) *
          (style === 'burst' ? this.rules.pops.burst.debris : 1),
        width: damage,
        life: 0.4 + delay,
        particle: target.particle,
        ...(target.boss && { boss: target.boss }),
        delay,
      });
      if (target.particle === 'meson') {
        const { quarks } = this.rules.particles.split;
        this.spawnAround(target, 'quark', quarks, 3);
      }
      const previous = this.level;
      this.gainXp(target.xp);
      this.levelUp(previous);
      if (target.kind === 'boss') this.endBoss(target.id);
      if (target.final) {
        this.finalDown = true;
        this.log('final-boss-down', { id: target.id });
      } else if (target.kind === 'boss') {
        const slots = this.skillSlots;
        this.bossesDown++;
        const opened = this.skillSlots > slots;
        this.banner = {
          kind: opened ? 'slot-open' : 'boss-down',
          until: this.time + this.rules.bannerSeconds,
          boss: target.boss,
        };
        this.log('boss-down', { id: target.id, slots: this.skillSlots });
      }
      this.score += Math.round(target.xp * 10 * (1 + target.radius / this.rules.spawnRadius));
      this.recordKillEnergy(target.xp);
      this.log('kill', {
        id: target.id,
        kind: target.kind,
        xp: this.xp,
        x: target.x,
        y: target.y,
        delay,
        style,
        particle: target.particle,
      });
    }
  }

  private popStyle(attack?: Attack, pop?: Pop): PopStyle {
    if (pop) return pop.style;
    if (attack?.source) return popStyles[attack.source];
    return attack?.fork ? 'burst' : 'tap';
  }

  // Kills in one tick pop in the rhythm of their style: lines in order along
  // the line, the others one after another at the style's interval.
  private popDelay(style: PopStyle, target: Target, from?: Point): number {
    const cfg = this.rules.pops;
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

  private recordKillEnergy(energy: number): void {
    this.kills.push({ tick: this.tick, energy });
    this.killEnergy += energy;
    const windowTicks = this.rules.rush.windowSeconds * this.rules.tickRate;
    while (
      this.killHead < this.kills.length &&
      this.tick - this.kills[this.killHead].tick >= windowTicks
    ) {
      this.killEnergy -= this.kills[this.killHead++].energy;
    }
    if (this.killHead > 1024) {
      this.kills.splice(0, this.killHead);
      this.killHead = 0;
    }
    if (this.killEnergy >= this.rules.rush.energyThreshold) {
      this.rushUntil = this.tick + this.rules.rush.windowSeconds * this.rules.tickRate;
      if (this.rushing)
        this.nextSpawn = Math.min(
          this.nextSpawn,
          this.tick + this.staged(this.rules.rush.spawnSecondsByStage) * this.rules.tickRate,
        );
    }
  }

  private summonEscorts(boss: Target): void {
    const { summonFractions } = boss.final ? this.rules.boss.final : this.rules.boss;
    boss.summons ??= 0;
    while (
      boss.summons < summonFractions.length &&
      boss.hp / boss.maxHp <= summonFractions[boss.summons]
    ) {
      boss.summons++;
      // The top quark splits into a swarm of mesons instead of calling quarks.
      if (boss.boss === 'top') this.spawnAround(boss, 'meson', boss.summonCount!, boss.size + 8);
      else this.spawnGroup('small', boss.summonCount!, boss.angle, 1, boss.radius);
    }
  }

  private gainXp(amount: number): void {
    const scale =
      (this.critical ? this.rules.critical.xpScale : 1) *
      (this.pacts.greed ? 1 + this.rules.pacts.greed.xp : 1);
    const gained = amount * scale + this.xpRemainder,
      whole = Math.floor(gained + 1e-8);
    this.xpRemainder = Math.max(0, gained - whole);
    this.xp += whole;
  }

  private beginCollapse(trigger: 'gravity' | 'boss'): void {
    this.endingOutcome = trigger === 'boss' ? 'success' : 'collapse-failure';
    this.collisionTime = this.time;
    this.endTrigger = trigger;
    this.phase = 'collapse';
    this.phaseTicks = 0;
    this.choice = null;
    this.combat.clear();
    this.damageNumbers = [];
    this.log('collision', {
      trigger,
      outcome: this.endingOutcome,
      xp: this.xp,
      mass: this.mass,
      radius: this.radius,
    });
  }

  private finishResult(): void {
    this.phase = 'result';
    this.result = {
      endless: this.clearResult
        ? { seconds: this.endlessSeconds, xp: this.xp - this.clearResult.xp }
        : null,
      outcome: this.endingOutcome,
      trigger: this.endTrigger,
      xp: this.xp,
      mass: this.mass,
      radius: this.radius,
      level: this.level,
      seed: this.seed,
      ranks: { ...this.ranks },
      boosts: { ...this.boosts },
      seconds: this.seconds,
      rarities: { ...this.rarities },
      score: this.score,
      rushSpawns: this.rushSpawns,
      collisionTime: this.collisionTime,
      waves: this.waveCount,
      counts: Object.fromEntries(
        particleIds.map((id) => [
          id,
          { ...this.counts[id], remaining: this.targets.filter((t) => t.particle === id).length },
        ]),
      ) as Result['counts'],
      selections: [...this.selections],
      metrics: { ...this.metrics },
    };
    this.log('result', this.result.outcome);
  }

  addEffect(input: EffectInput): void {
    const { kind, from, to, radius, width, life, source, anchor, endAnchor, targetId } = input;
    const { particle, boss, delay } = input;
    const rarity = input.rarity ?? (source ? this.rarities[source] : 'common');
    const rank = input.rank ?? (source ? this.rank(source) : 0);
    const effect = {
      kind,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      radius,
      width,
      damage: input.damage ?? 0,
      born: this.seconds,
      life,
      source,
      rank,
      rarity,
      anchor,
      endAnchor,
      targetId,
      arc: input.arc ? { ...input.arc } : undefined,
      particle,
      boss,
      delay,
    };
    this.effects.push(effect);
    if (this.effects.length > 160) {
      const discard = this.effects.findIndex((fx) =>
        ['kill', 'absorb', 'charge', 'field'].includes(fx.kind),
      );
      this.effects.splice(Math.max(0, discard), 1);
    }
    this.metrics.maxEffects = Math.max(this.metrics.maxEffects, this.effects.length);
  }
  log(kind: string, data: unknown): void {
    this.events.push({ time: this.time, kind, data });
    // Keep every fresh cue, including a large burst; simulations retain the full trace.
    if (!this.recordEvents && this.events.length > 1024) {
      const discard = this.events.findIndex((event) => event.time >= this.time - 0.25);
      if (discard > 0) {
        this.events.splice(0, discard);
        this.eventOffset += discard;
      }
    }
  }
}
