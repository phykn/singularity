import { Random } from './random.ts';
import { particleIds, particleKind, particleMotion } from './particles.ts';
import type { ParticleKind } from './particles.ts';
import { eligibleUpgrades, makeCards } from './growth.ts';
import { CENTER, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import {
  blankBoosts,
  blankRanks,
  blankRarities,
  coreRadius,
  formValues,
  higherRarity,
  isSkill,
  levelForXp,
  orbitTarget,
  rarityIds,
  rarityScale,
  rollRarity,
  rules,
  xpForLevel,
} from './rules.ts';
import type { FormValues, RuleSet, UpgradeId } from './rules.ts';

import { Combat } from './combat.ts';
import type { Attack } from './combat.ts';
import { maxDamageNumbers } from './rules.ts';
import type {
  Checkpoint,
  Choice,
  Count,
  DamageNumber,
  Effect,
  EffectInput,
  Event,
  Metrics,
  Outcome,
  Phase,
  Result,
  Selection,
  Target,
  TargetKind,
} from './types.ts';

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
  ranks = blankRanks();
  boosts = blankBoosts();
  rarities = blankRarities();
  score = 0;
  rushSpawns = 0;
  private kills: { tick: number; energy: number }[] = [];
  private killHead = 0;
  private killEnergy = 0;
  private rushUntil = 0;
  targets: Target[] = [];
  effects: Effect[] = [];
  damageNumbers: DamageNumber[] = [];
  choice: Choice | null = null;
  selections: Selection[] = [];
  waves: { time: number; angle: number }[];
  waveCount = 0;
  result: Result | null = null;
  manualPaused = false;
  hiddenPaused = false;
  counts = Object.fromEntries(
    particleIds.map((id) => [id, { generated: 0, killed: 0, absorbed: 0 }]),
  ) as Record<ParticleKind, Count>;
  events: Event[] = [];
  notice: UpgradeId | '' = '';
  noticeUntil = 0;
  readonly combat: Combat;
  combatEnabled: boolean;
  collisionTime = 0;
  collisionTrigger: 'gravity' | 'energy' = 'gravity';
  metrics: Metrics;
  private randomSpawn: Random;
  private randomCards: Random;
  private randomRarity: Random;
  private nextSpawn = 0;
  private batchCount = 0;
  private nextTargetId = 0;
  private nextDamageId = 0;
  private remainder = 0;
  private endingOutcome: Outcome = 'collapse-failure';

  constructor(seed: number, options: { combat?: boolean; rules?: RuleSet } = {}) {
    this.rules = options.rules ?? rules;
    this.radius = this.rules.orbitRadius;
    this.metrics = {
      minRadius: this.radius,
      minMargin: this.radius - this.rules.coreRadius - this.rules.electronRadius,
      dangerSeconds: 0,
      maxTargets: 0,
      maxEffects: 0,
    };
    this.seed = seed >>> 0;
    this.randomSpawn = new Random(this.seed ^ 0x9e3779b9);
    this.randomCards = new Random(this.seed ^ 0xc2b2ae35);
    this.randomRarity = new Random(this.seed ^ 0x27d4eb2f);
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
  get level(): number {
    return levelForXp(this.xp, this.rules);
  }
  get speed(): number {
    return (
      this.rules.baseSpeed *
      (1 +
        this.rules.speedPerRank * this.boosts.accel * rarityScale(this.rarities.accel, this.rules))
    );
  }
  get damage(): number {
    return (
      this.rules.baseHitDamage +
      this.rules.damagePerRank * this.boosts.power * rarityScale(this.rarities.power, this.rules)
    );
  }
  get rate(): number {
    return (
      1 + this.rules.ratePerRank * this.boosts.rate * rarityScale(this.rarities.rate, this.rules)
    );
  }
  get forms(): FormValues {
    return formValues(this.ranks, this.rarities, this.rules);
  }
  get rushing(): boolean {
    return (
      this.phase === 'running' &&
      this.tick < this.rushUntil &&
      this.targets.length < this.rules.rush.maxTargetsByStage[this.stage]
    );
  }
  get attackInterval(): number {
    return this.rules.attackBaseSeconds / this.rate;
  }
  get core(): number {
    return coreRadius(this.mass, this.rules);
  }
  get targetRadius(): number {
    return orbitTarget(
      this.mass,
      this.boosts.accel * rarityScale(this.rarities.accel, this.rules),
      this.rules,
    );
  }
  get margin(): number {
    return this.radius - this.core - this.rules.electronRadius;
  }
  get charged(): boolean {
    return this.xp >= this.rules.energyGoal;
  }
  get paused(): boolean {
    return this.manualPaused || this.hiddenPaused;
  }
  get position(): Point {
    return orbit(this.angle, this.radius);
  }
  get stage(): number {
    return this.rules.stageStarts.filter((start) => this.time >= start).length - 1;
  }
  get nextXp(): number {
    return xpForLevel(this.level + 1, this.rules);
  }
  get levelProgress(): { current: number; required: number } {
    const previous = xpForLevel(this.level, this.rules);
    return { current: this.xp - previous, required: this.nextXp - previous };
  }
  get upcomingWave() {
    if (this.waveCount < this.waves.length) return this.waves[this.waveCount];
    const last = this.waves.at(-1)!,
      repeat = this.waveCount - this.waves.length + 1;
    return {
      time: last.time + repeat * this.rules.waveRepeatSeconds,
      angle: (last.angle + repeat * Math.PI * (3 - Math.sqrt(5))) % (Math.PI * 2),
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
        (this.phase === 'collapse'
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
    return isSkill(id) ? this.ranks[id] : this.boosts[id];
  }

  start(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'running';
    this.log('start', { seed: this.seed });
    if (this.combatEnabled) {
      this.spawnBatch();
      this.nextSpawn = this.rules.spawnSecondsByStage[this.stage] * this.rules.tickRate;
    }
  }
  setManualPause(paused: boolean): void {
    this.manualPaused = paused;
  }
  setHidden(paused: boolean): void {
    this.hiddenPaused = paused;
  }

  checkpoint(): Checkpoint | null {
    if (this.phase === 'ready' || !this.combatEnabled) return null;
    return {
      seed: this.seed,
      ticks: this.elapsedTicks,
      phase: this.phase,
      manualPaused: this.manualPaused,
      inputs: this.selections.flatMap((selection, i) =>
        selection.automatic
          ? []
          : [
              {
                tick: Math.round(selection.time * this.rules.tickRate),
                id: selection.id,
                number: i + 1,
              },
            ],
      ),
    };
  }

  static restore(checkpoint: Checkpoint): Game | null {
    const game = new Game(checkpoint.seed);
    game.start();
    for (const input of checkpoint.inputs) {
      if (input.tick < game.tick || input.tick > checkpoint.ticks) return null;
      game.advance(((input.tick - game.tick) * 1000) / game.rules.tickRate);
      if (!game.select(input.id, false, input.number)) return null;
    }
    game.advance(((checkpoint.ticks - game.elapsedTicks) * 1000) / game.rules.tickRate);
    if (game.elapsedTicks !== checkpoint.ticks || game.phase !== checkpoint.phase) return null;
    game.manualPaused = checkpoint.manualPaused;
    return game;
  }

  advance(milliseconds: number, tickLimit = Infinity): void {
    if (this.paused || this.phase === 'ready' || this.phase === 'result') return;
    this.remainder += (milliseconds * this.rules.tickRate) / 1000;
    const count = Math.min(Math.floor(this.remainder + 1e-8), tickLimit);
    this.remainder -= count;
    for (let i = 0; i < count && !this.result; i++) {
      this.elapsedTicks++;
      if (this.phase === 'running') this.step();
      else {
        this.phaseTicks++;
        if (this.phaseProgress >= 1) {
          this.phaseTicks = 0;
          if (this.phase === 'collapse') {
            this.phase = 'ending';
            this.log('ending', this.endingOutcome);
          } else this.finishResult();
        }
      }
      this.effects = this.effects.filter((fx) => this.seconds < fx.born + fx.life);
      this.damageNumbers = this.damageNumbers.filter((damage) => this.seconds < damage.born + 0.72);
    }
  }

  private step(): void {
    this.tick++;
    if (this.charged) {
      this.collide('energy');
      return;
    }
    if (this.choice && this.time >= this.choice.deadline)
      this.select(this.choice.cards[0].id, true);
    if (this.combatEnabled && this.tick + 1e-8 >= this.nextSpawn) {
      const rushing = this.rushing;
      this.spawnBatch();
      if (rushing) {
        this.rushSpawns++;
        this.log('rush', { count: this.rushSpawns });
      }
      this.nextSpawn +=
        (rushing
          ? this.rules.rush.spawnSecondsByStage[this.stage]
          : this.rules.spawnSecondsByStage[this.stage]) * this.rules.tickRate;
    }
    const wave = this.upcomingWave;
    if (wave && this.time >= wave.time) {
      if (this.combatEnabled) {
        const scale =
          this.rules.waveScale[Math.min(this.waveCount, this.rules.waveScale.length - 1)];
        this.spawnGroup('small', Math.round((this.rules.waveSmall / 2) * scale), wave.angle, 1);
        this.spawnGroup(
          'small',
          Math.round((this.rules.waveSmall / 2) * scale),
          wave.angle + Math.PI,
          -1,
        );
        this.spawnGroup(
          'dense',
          Math.round((this.rules.waveDense / 2) * scale),
          wave.angle + 0.15,
          1,
        );
        this.spawnGroup(
          'dense',
          Math.round((this.rules.waveDense / 2) * scale),
          wave.angle + Math.PI + 0.15,
          -1,
        );
      }
      this.waveCount++;
      this.log('wave', { number: this.waveCount, angle: wave.angle });
    }
    this.moveTargets();
    this.angle += this.speed / this.radius / this.rules.tickRate;
    this.combat.update();
    if (this.charged) {
      this.collide('energy');
      return;
    }
    this.absorbTargets();
    this.updateOrbit();
    this.metrics.minRadius = Math.min(this.metrics.minRadius, this.radius);
    this.metrics.minMargin = Math.min(this.metrics.minMargin, this.margin);
    if (this.margin > 0 && this.margin < this.rules.dangerMargin && !this.charged)
      this.metrics.dangerSeconds += 1 / this.rules.tickRate;
    if (this.margin <= 0) {
      this.collide('gravity');
      return;
    }
    this.openChoice();
  }

  moveTargets(): void {
    for (const target of this.targets) {
      const motion = particleMotion(target.particle, this.time - target.born);
      target.radius = Math.max(
        0,
        target.radius - (target.speed * motion.speed) / this.rules.tickRate,
      );
      target.angle += (target.turn * motion.turn) / this.rules.tickRate;
      Object.assign(target, orbit(target.angle, target.radius));
    }
  }

  absorbTargets(): void {
    const core = this.core;
    const absorbed = this.targets
      .filter((t) => t.hp > 0 && t.radius <= core + t.size)
      .sort((a, b) => a.id - b.id);
    for (const target of absorbed) {
      this.mass += target.mass;
      this.counts[target.particle].absorbed++;
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
  }

  updateOrbit(): void {
    const change = this.targetRadius - this.radius;
    this.radius +=
      Math.sign(change) *
      Math.min(
        Math.abs(change),
        (change < 0 ? this.rules.inwardSpeed : this.rules.outwardSpeed) / this.rules.tickRate,
      );
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
    const cards = makeCards(
      { ranks: this.ranks, boosts: this.boosts, number, danger },
      this.randomCards,
      this.rules,
    ).map((id) => ({
      id,
      rarity: higherRarity(this.rarities[id], rollRarity(this.randomRarity.next(), this.rules)),
    }));
    if (number > 1 && !(danger && cards[0].id === 'accel')) {
      const best = cards.reduce((a, b) =>
        rarityIds.indexOf(b.rarity) > rarityIds.indexOf(a.rarity) ? b : a,
      );
      if (rarityIds.indexOf(best.rarity) - rarityIds.indexOf(cards[0].rarity) >= 2)
        cards.unshift(...cards.splice(cards.indexOf(best), 1));
    }
    this.choice = {
      cards,
      number,
      opened: this.time,
      deadline: (this.tick + this.rules.choiceSeconds * this.rules.tickRate) / this.rules.tickRate,
    };
    this.log('cards', { number, cards });
  }

  select(id: UpgradeId, automatic = false, choiceNumber = this.choice?.number): boolean {
    if (
      this.paused ||
      this.phase !== 'running' ||
      !this.choice ||
      choiceNumber !== this.choice.number
    )
      return false;
    const card = this.choice.cards.find((card) => card.id === id);
    if (!card) return false;
    if (!automatic && this.time >= this.choice.deadline) return false;
    if (!eligibleUpgrades(this.ranks, this.rules).includes(id)) return false;
    const previous = this.rank(id),
      oldRate = this.rate;
    this.rarities[id] = higherRarity(this.rarities[id], card.rarity);
    if (isSkill(id)) this.ranks[id]++;
    else this.boosts[id]++;
    if (id === 'rate') this.combat.rescaleCooldowns(oldRate);
    const selection = {
      time: this.time,
      id,
      rank: this.rank(id),
      rarity: this.rarities[id],
      automatic,
    };
    this.selections.push(selection);
    this.log('skill', selection);
    this.addEffect({
      kind: 'upgrade',
      from: this.position,
      to: this.position,
      radius: id === 'accel' ? 30 : 18,
      width: 1,
      life: 0.7,
      source: id,
      rarity: this.rarities[id],
      anchor: 'electron',
    });
    this.notice = id;
    this.noticeUntil = this.time + 2;
    this.combat.learn(id, previous);
    this.choice = null;
    this.openChoice();
    return true;
  }

  spawnBatch(): void {
    const roll = this.randomSpawn.next(),
      angle = this.randomSpawn.next() * Math.PI * 2,
      direction = this.randomSpawn.next() < 0.5 ? -1 : 1;
    const intro = this.batchCount < this.rules.introBatches;
    const kind =
      intro || roll < this.rules.smallBatchProbabilityByStage[this.stage] ? 'small' : 'dense';
    const size = kind === 'small' ? this.rules.smallBatchSize : this.rules.denseBatchSize;
    const count = Math.round(size * (intro ? 1 : this.rules.batchScale[this.stage]));
    this.spawnGroup(kind, count, intro ? this.angle + 0.35 : angle, direction);
    this.batchCount++;
  }

  private spawnGroup(kind: TargetKind, count: number, angle: number, direction: number): void {
    const data = this.rules.targets[kind];
    const planned = [];
    for (let i = 0; i < count; i++) {
      const theta = angle + (i - (count - 1) / 2) * (kind === 'small' ? 0.095 : 0.46);
      const id = this.nextTargetId++,
        particle = particleKind(kind, id, this.stage),
        heavy = particle === 'neutron';
      const hp = Math.round(data.hp[this.stage] * (heavy ? 1.2 : 1));
      const target: Target = {
        id,
        ...orbit(theta, this.rules.spawnRadius),
        angle: theta,
        radius: this.rules.spawnRadius,
        kind,
        particle,
        born: this.time,
        hp,
        maxHp: hp,
        xp: heavy ? 6 : data.xp,
        mass: heavy ? 6 : data.mass,
        size: data.size,
        speed: data.speed * (heavy ? 0.85 : 1),
        turn: data.turn * direction,
      };
      this.targets.push(target);
      this.counts[particle].generated++;
      planned.push({ id, kind, angle: theta, hp });
    }
    this.metrics.maxTargets = Math.max(this.metrics.maxTargets, this.targets.length);
    this.log('spawn', { planned });
  }

  damageTarget(target: Target, damage: number, attack?: Attack): void {
    if (target.hp <= 0) return;
    const index = this.targets.indexOf(target);
    if (index === -1) return;
    target.hp -= damage;
    if (target.hp < 1e-8) target.hp = 0;
    target.hitAt = this.time;
    this.log('hit', { id: target.id, kind: target.kind, damage });
    this.damageNumbers.push({
      id: this.nextDamageId++,
      x: target.x,
      y: target.y,
      value: damage,
      born: this.seconds,
      rarity: attack?.rarities.power ?? this.rarities.power,
    });
    if (this.damageNumbers.length > maxDamageNumbers)
      this.damageNumbers.splice(0, this.damageNumbers.length - maxDamageNumbers);
    if (target.hp <= 0) {
      if (attack && !attack.firstKill) attack.firstKill = { x: target.x, y: target.y };
      this.counts[target.particle].killed++;
      this.targets.splice(index, 1);
      this.addEffect({
        kind: 'kill',
        from: target,
        to: this.position,
        radius: 8,
        width: damage,
        life: 0.4,
      });
      const before = this.charged;
      const previous = this.level;
      this.xp += target.xp;
      this.levelUp(previous);
      this.score += Math.round(target.xp * 10 * (1 + target.radius / this.rules.spawnRadius));
      this.kills.push({ tick: this.tick, energy: target.xp });
      this.killEnergy += target.xp;
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
            this.tick + this.rules.rush.spawnSecondsByStage[this.stage] * this.rules.tickRate,
          );
      }
      this.log('kill', { id: target.id, kind: target.kind, xp: this.xp });
      if (!before && this.charged) this.log('charged', { xp: this.xp });
    }
  }

  private collide(trigger: 'gravity' | 'energy'): void {
    this.endingOutcome = this.charged ? 'success' : 'collapse-failure';
    this.collisionTime = this.time;
    this.collisionTrigger = trigger;
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
      outcome: this.endingOutcome,
      trigger: this.collisionTrigger,
      xp: this.xp,
      mass: this.mass,
      radius: this.radius,
      level: this.level,
      speed: this.speed,
      missingXp: Math.max(0, this.rules.energyGoal - this.xp),
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
    const { kind, from, to, radius, width, life, source, anchor, targetId } = input;
    const rarity = input.rarity ?? (source ? this.rarities[source] : 'common');
    const rank = input.rank ?? (source ? this.rank(source) : 0);
    const effect = {
      kind,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      radius,
      width,
      born: this.seconds,
      life,
      source,
      rank,
      rarity,
      anchor,
      targetId,
    };
    this.effects.push(effect);
    if (this.effects.length > 160) {
      const discard = this.effects.findIndex((fx) => ['kill', 'absorb', 'area'].includes(fx.kind));
      this.effects.splice(Math.max(0, discard), 1);
    }
    this.metrics.maxEffects = Math.max(this.metrics.maxEffects, this.effects.length);
  }
  log(kind: string, data: unknown): void {
    this.events.push({ time: this.time, kind, data });
  }
}
