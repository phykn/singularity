import { Random } from './random.ts';
import { eligibleUpgrades, makeCards } from './growth.ts';
import { CENTER, distance, norm, orbit, orbitRadius } from './geometry.ts';
import type { Point } from './geometry.ts';
import { blankBoosts, blankRanks, blankRarities, coreRadius, formValues, higherRarity, isSkill, orbitTarget, rarityIds, rarityScale, rollRarity, rules } from './rules.ts';
import type { Boosts, Card, FormValues, Ranks, Rarities, Rarity, RuleSet, SkillId, UpgradeId } from './rules.ts';

const HZ = rules.tickRate;
export type TargetKind = 'small' | 'dense';
export type Phase = 'ready' | 'running' | 'collapse' | 'ending' | 'result';
export type Target = Point & { id: number; kind: TargetKind; hp: number; maxHp: number; xp: number; mass: number; size: number; radius: number; angle: number; speed: number; turn: number; hitAt?: number };
export type Effect = { kind: 'bolt' | 'area' | 'pierce' | 'strike' | 'wave' | 'whip' | 'focus' | 'kill' | 'level' | 'absorb'; from: Point; to: Point; radius: number; width: number; born: number; life: number; source?: SkillId; rarity: Rarity; targetId?: number; anchor?: 'electron' };
export const maxDamageNumbers = 64;
export type DamageNumber = Point & { id: number; value: number; born: number; rarity: Rarity };
export type Choice = { cards: Card[]; number: number; opened: number; deadline: number };
export type Count = { generated: number; killed: number; absorbed: number };
export type Outcome = 'success' | 'collapse-failure';
export type Selection = { time: number; id: UpgradeId; rank: number; rarity: Rarity; automatic: boolean };
export type Metrics = { minRadius: number; minMargin: number; dangerSeconds: number; maxTargets: number; maxEffects: number };
export type Result = { outcome: Outcome; trigger: 'gravity' | 'final'; xp: number; mass: number; radius: number; level: number; speed: number; missingXp: number; seed: number; ranks: Ranks; boosts: Boosts; rarities: Rarities; score: number; rushSpawns: number; seconds: number; collisionTime: number; waves: number; counts: Record<TargetKind, Count & { remaining: number }>; selections: Selection[]; metrics: Metrics };
type Attack = { id: number; ranks: Ranks; rarities: Rarities; forms: FormValues; damage: number; burstFired: boolean; firstKill?: Point };
type Pulse = { at: number; order: number; attack: Attack; target: Target };
type TimedSkill = 'strike' | 'wave' | 'whip' | 'focus';
type Sweep = { attack: Attack; from: Point; born: number; previous: number; hit: Set<number>; angle: number };
type Focus = { attack: Attack; until: number; next: number; target?: Target };
export type Event = { time: number; kind: string; data: unknown };
export type Checkpoint = { seed: number; ticks: number; phase: Exclude<Phase, 'ready'>; manualPaused: boolean; inputs: { tick: number; id: UpgradeId; number: number }[] };

const closest = (targets: Target[], point: Point) => [...targets].sort((a, b) => distance(a, point) - distance(b, point) || a.id - b.id);

export class Game {
  readonly rules: RuleSet;
  seed: number;
  phase: Phase = 'ready';
  tick = 0;
  elapsedTicks = 0;
  phaseTicks = 0;
  xp = 0;
  mass = 0;
  radius = orbitRadius;
  angle = -Math.PI / 2;
  ranks = blankRanks();
  boosts = blankBoosts();
  rarities = blankRarities();
  score = 0;
  rushSpawns = 0;
  private kills: { tick: number; energy: number }[] = [];
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
  counts: Record<TargetKind, Count> = { small: { generated: 0, killed: 0, absorbed: 0 }, dense: { generated: 0, killed: 0, absorbed: 0 } };
  events: Event[] = [];
  skillActivations: Partial<Record<SkillId, number>> = {};
  notice: UpgradeId | '' = '';
  noticeUntil = 0;
  combat: boolean;
  collisionTime = 0;
  collisionTrigger: 'gravity' | 'final' = 'final';
  metrics: Metrics = { minRadius: orbitRadius, minMargin: orbitRadius - rules.coreRadius - rules.electronRadius, dangerSeconds: 0, maxTargets: 0, maxEffects: 0 };
  private randomSpawn: Random;
  private randomCards: Random;
  private randomRarity: Random;
  private nextSpawn = 0;
  private nextAttack = rules.attackBaseSeconds * HZ;
  private batchCount = 0;
  private nextTargetId = 0;
  private nextAttackId = 0;
  private nextDamageId = 0;
  private pulses: Pulse[] = [];
  private nextSkill: Record<TimedSkill, number> = { strike: Infinity, wave: Infinity, whip: Infinity, focus: Infinity };
  private wave: Sweep | null = null;
  private whip: Sweep | null = null;
  private focus: Focus | null = null;
  private remainder = 0;
  private endingOutcome: Outcome = 'collapse-failure';

  constructor(seed: number, options: { combat?: boolean; rules?: RuleSet } = {}) {
    this.rules = options.rules ?? rules;
    this.seed = seed >>> 0;
    this.randomSpawn = new Random(this.seed ^ 0x9E3779B9);
    this.randomCards = new Random(this.seed ^ 0xC2B2AE35);
    this.randomRarity = new Random(this.seed ^ 0x27D4EB2F);
    const waveRandom = new Random(this.seed ^ 0xA511E9B3);
    this.waves = this.rules.waves.map((time) => ({ time, angle: waveRandom.next() * Math.PI * 2 }));
    this.combat = options.combat ?? true;
  }

  get time(): number { return this.tick / HZ; }
  get seconds(): number { return this.elapsedTicks / HZ; }
  get level(): number { return 1 + this.rules.levelXp.filter((xp) => this.xp >= xp).length; }
  get speed(): number { return this.rules.baseSpeed * (1 + this.rules.speedPerRank * this.boosts.accel * rarityScale(this.rarities.accel, this.rules)); }
  get damage(): number { return this.rules.baseHitDamage + this.rules.damagePerRank * this.boosts.power * rarityScale(this.rarities.power, this.rules); }
  get rate(): number { return 1 + this.rules.ratePerRank * this.boosts.rate * rarityScale(this.rarities.rate, this.rules); }
  get forms(): FormValues { return formValues(this.ranks, this.rarities, this.rules); }
  get rushing(): boolean { return this.phase === 'running' && this.tick < this.rushUntil && this.targets.length < this.rules.rush.maxTargetsByStage[this.stage]; }
  get attackInterval(): number { return this.rules.attackBaseSeconds / this.rate; }
  get core(): number { return coreRadius(this.mass, this.rules); }
  get targetRadius(): number { return orbitTarget(this.mass, this.boosts.accel * rarityScale(this.rarities.accel, this.rules), this.rules); }
  get margin(): number { return this.radius - this.core - this.rules.electronRadius; }
  get charged(): boolean { return this.xp >= this.rules.energyGoal; }
  get paused(): boolean { return this.manualPaused || this.hiddenPaused; }
  get position(): Point { return orbit(this.angle, this.radius); }
  get stage(): number { return Math.max(0, this.rules.stageEnds.findIndex((end) => this.time < end)); }
  get nextXp(): number | undefined { return this.rules.levelXp[this.level - 1]; }
  get levelProgress(): { current: number; required: number } {
    const previous = this.rules.levelXp[this.level - 2] ?? 0;
    return { current: this.xp - previous, required: (this.nextXp ?? previous) - previous };
  }
  get upcomingWave() { return this.waves[this.waveCount]; }
  get warningWave() { const wave = this.upcomingWave; return this.phase === 'running' && wave && wave.time - this.time <= this.rules.waveWarningSeconds ? wave : null; }
  get phaseProgress(): number { return this.phaseTicks / (HZ * (this.phase === 'collapse' ? this.rules.collisionSeconds : this.successfulEnding ? this.rules.successEndingSeconds : this.rules.failureEndingSeconds)); }
  get successfulEnding(): boolean { return this.endingOutcome === 'success'; }
  rank(id: UpgradeId): number { return isSkill(id) ? this.ranks[id] : this.boosts[id]; }

  start(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'running';
    this.log('start', { seed: this.seed });
    if (this.combat) { this.spawnBatch(); this.nextSpawn = this.rules.spawnSecondsByStage[this.stage] * HZ; }
  }
  setManualPause(paused: boolean): void { this.manualPaused = paused; }
  setHidden(paused: boolean): void { this.hiddenPaused = paused; }

  checkpoint(): Checkpoint | null {
    if (this.phase === 'ready' || !this.combat) return null;
    return {
      seed: this.seed, ticks: this.elapsedTicks, phase: this.phase, manualPaused: this.manualPaused,
      inputs: this.selections.flatMap((selection, i) => selection.automatic ? [] : [{ tick: Math.round(selection.time * HZ), id: selection.id, number: i + 1 }]),
    };
  }

  static restore(checkpoint: Checkpoint): Game | null {
    const game = new Game(checkpoint.seed);
    game.start();
    for (const input of checkpoint.inputs) {
      if (input.tick < game.tick || input.tick > checkpoint.ticks) return null;
      game.advance((input.tick - game.tick) * 1000 / HZ);
      if (!game.select(input.id, false, input.number)) return null;
    }
    game.advance((checkpoint.ticks - game.elapsedTicks) * 1000 / HZ);
    if (game.elapsedTicks !== checkpoint.ticks || game.phase !== checkpoint.phase) return null;
    game.manualPaused = checkpoint.manualPaused;
    return game;
  }

  advance(milliseconds: number): void {
    if (this.paused || this.phase === 'ready' || this.phase === 'result') return;
    this.remainder += milliseconds * HZ / 1000;
    const count = Math.floor(this.remainder + 1e-8);
    this.remainder -= count;
    for (let i = 0; i < count && !this.result; i++) {
      this.elapsedTicks++;
      if (this.phase === 'running') this.step();
      else {
        this.phaseTicks++;
        if (this.phaseProgress >= 1) {
          this.phaseTicks = 0;
          if (this.phase === 'collapse') { this.phase = 'ending'; this.log('ending', this.endingOutcome); }
          else this.finishResult();
        }
      }
      this.effects = this.effects.filter((fx) => this.seconds < fx.born + fx.life);
      this.damageNumbers = this.damageNumbers.filter((damage) => this.seconds < damage.born + .72);
    }
  }

  private step(): void {
    this.tick++;
    if (this.tick >= this.rules.growthSeconds * HZ) { this.collide('final'); return; }
    if (this.choice && this.time >= this.choice.deadline) this.select(this.choice.cards[0].id, true);
    if (this.combat && this.tick + 1e-8 >= this.nextSpawn) {
      const rushing = this.rushing;
      this.spawnBatch();
      if (rushing) { this.rushSpawns++; this.log('rush', { count: this.rushSpawns }); }
      this.nextSpawn += (rushing ? this.rules.rush.spawnSecondsByStage[this.stage] : this.rules.spawnSecondsByStage[this.stage]) * HZ;
    }
    const wave = this.upcomingWave;
    if (wave && this.time >= wave.time) {
      if (this.combat) {
        this.spawnGroup('small', Math.round(this.rules.waveSmall / 2 * this.rules.waveScale[this.waveCount]), wave.angle, 1);
        this.spawnGroup('small', Math.round(this.rules.waveSmall / 2 * this.rules.waveScale[this.waveCount]), wave.angle + Math.PI, -1);
        this.spawnGroup('dense', Math.round(this.rules.waveDense / 2 * this.rules.waveScale[this.waveCount]), wave.angle + .15, 1);
        this.spawnGroup('dense', Math.round(this.rules.waveDense / 2 * this.rules.waveScale[this.waveCount]), wave.angle + Math.PI + .15, -1);
      }
      this.waveCount++;
      this.log('wave', { number: this.waveCount, angle: wave.angle });
    }
    this.moveTargets();
    this.angle += this.speed / this.radius / HZ;
    const due = this.pulses.filter((p) => p.at <= this.tick + 1e-8).sort((a, b) => a.attack.id - b.attack.id || a.order - b.order);
    this.pulses = this.pulses.filter((p) => p.at > this.tick + 1e-8);
    due.forEach((pulse) => this.hitPulse(pulse, this.position, true));
    if (this.combat && this.tick + 1e-8 >= this.nextAttack) { this.fireBasic(); this.nextAttack += this.attackInterval * HZ; }
    this.updateSkills();
    this.absorbTargets();
    this.updateOrbit();
    this.metrics.minRadius = Math.min(this.metrics.minRadius, this.radius);
    this.metrics.minMargin = Math.min(this.metrics.minMargin, this.margin);
    if (this.margin > 0 && this.margin < this.rules.dangerMargin && !this.charged) this.metrics.dangerSeconds += 1 / HZ;
    if (this.margin <= 0) { this.collide('gravity'); return; }
    this.openChoice();
  }

  moveTargets(): void {
    for (const target of this.targets) {
      target.radius = Math.max(0, target.radius - target.speed / HZ);
      target.angle += target.turn / HZ;
      Object.assign(target, orbit(target.angle, target.radius));
    }
  }

  absorbTargets(): void {
    const core = this.core;
    const absorbed = this.targets.filter((t) => t.hp > 0 && t.radius <= core + t.size).sort((a, b) => a.id - b.id);
    for (const target of absorbed) {
      this.mass += target.mass;
      this.counts[target.kind].absorbed++;
      this.effect('absorb', target, CENTER, this.core + 10, 1, .5);
      this.log('absorb', { id: target.id, kind: target.kind, mass: this.mass });
    }
    const ids = new Set(absorbed.map((t) => t.id));
    this.targets = this.targets.filter((t) => !ids.has(t.id) && t.hp > 0);
  }

  updateOrbit(): void {
    const change = this.targetRadius - this.radius;
    this.radius += Math.sign(change) * Math.min(Math.abs(change), (change < 0 ? this.rules.inwardSpeed : this.rules.outwardSpeed) / HZ);
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
    this.effect('level', this.position, this.position, 24, 1, .5);
  }

  private openChoice(): void {
    if (this.phase !== 'running' || this.choice || this.selections.length >= this.level - 1) return;
    const number = this.selections.length + 1;
    const danger = this.margin < this.rules.dangerMargin;
    const cards = makeCards({ ranks: this.ranks, boosts: this.boosts, number, danger }, this.randomCards, this.rules)
      .map((id) => ({ id, rarity: higherRarity(this.rarities[id], rollRarity(this.randomRarity.next(), this.rules)) }));
    if (number > 1 && !(danger && cards[0].id === 'accel')) {
      const best = cards.reduce((a, b) => rarityIds.indexOf(b.rarity) > rarityIds.indexOf(a.rarity) ? b : a);
      if (rarityIds.indexOf(best.rarity) - rarityIds.indexOf(cards[0].rarity) >= 2) cards.unshift(...cards.splice(cards.indexOf(best), 1));
    }
    this.choice = { cards, number, opened: this.time, deadline: (this.tick + this.rules.choiceSeconds * HZ) / HZ };
    this.log('cards', { number, cards });
  }

  select(id: UpgradeId, automatic = false, choiceNumber = this.choice?.number): boolean {
    if (this.paused || this.phase !== 'running' || !this.choice || choiceNumber !== this.choice.number) return false;
    const card = this.choice.cards.find((card) => card.id === id);
    if (!card) return false;
    if (!automatic && this.time >= this.choice.deadline) return false;
    if (!eligibleUpgrades(this.ranks, this.boosts, this.rules).includes(id)) return false;
    const previous = this.rank(id), oldRate = this.rate;
    this.rarities[id] = higherRarity(this.rarities[id], card.rarity);
    if (isSkill(id)) this.ranks[id]++; else this.boosts[id]++;
    if (id === 'rate') {
      const ratio = oldRate / this.rate;
      this.nextAttack = this.tick + Math.max(0, this.nextAttack - this.tick) * ratio;
      for (const id of Object.keys(this.nextSkill) as TimedSkill[]) {
        if (Number.isFinite(this.nextSkill[id])) this.nextSkill[id] = this.tick + Math.max(0, this.nextSkill[id] - this.tick) * ratio;
      }
    }
    const selection = { time: this.time, id, rank: this.rank(id), rarity: this.rarities[id], automatic };
    this.selections.push(selection);
    this.log('skill', selection);
    this.effect('level', this.position, this.position, id === 'accel' ? 30 : 18, 1, .5, undefined, this.rarities[id]);
    this.notice = id;
    this.noticeUntil = this.time + 1.5;
    if (id in this.nextSkill && previous === 0) this.nextSkill[id as TimedSkill] = this.tick + 1;
    this.choice = null;
    this.openChoice();
    return true;
  }

  spawnBatch(): void {
    const roll = this.randomSpawn.next(), angle = this.randomSpawn.next() * Math.PI * 2, direction = this.randomSpawn.next() < .5 ? -1 : 1;
    const intro = this.batchCount < this.rules.introBatches;
    const kind = intro || roll < this.rules.smallBatchProbabilityByStage[this.stage] ? 'small' : 'dense';
    const size = kind === 'small' ? this.rules.smallBatchSize : this.rules.denseBatchSize;
    const count = Math.round(size * (intro ? 1 : this.rules.batchScale[this.stage]));
    this.spawnGroup(kind, count, intro ? this.angle + .35 : angle, direction);
    this.batchCount++;
  }

  private spawnGroup(kind: TargetKind, count: number, angle: number, direction: number): void {
    const data = this.rules.targets[kind];
    const planned = [];
    for (let i = 0; i < count; i++) {
      const theta = angle + (i - (count - 1) / 2) * (kind === 'small' ? .095 : .46);
      const hp = data.hp[this.stage], id = this.nextTargetId++;
      const target: Target = { id, ...orbit(theta, this.rules.spawnRadius), angle: theta, radius: this.rules.spawnRadius, kind, hp, maxHp: hp, xp: data.xp, mass: data.mass, size: data.size, speed: data.speed, turn: data.turn * direction };
      this.targets.push(target);
      this.counts[kind].generated++;
      planned.push({ id, kind, angle: theta, hp });
    }
    this.metrics.maxTargets = Math.max(this.metrics.maxTargets, this.targets.length);
    this.log('spawn', { planned });
  }

  fireBasic(origin: Point = this.position): void {
    const forms = this.forms;
    const selected = closest(this.targets.filter((t) => t.hp > 0 && distance(t, origin) <= this.rules.primaryRange), origin).slice(0, forms.multi.count);
    if (!selected.length) return;
    const attack: Attack = { id: this.nextAttackId++, ranks: { ...this.ranks }, rarities: { ...this.rarities }, forms, damage: this.damage, burstFired: false };
    selected.forEach((target, order) => {
      for (let hit = 1; hit < forms.repeat.hits; hit++) this.pulses.push({ at: this.tick + hit * this.rules.skills.repeat.delaySeconds * HZ, order, attack, target });
      this.hitPulse({ at: this.tick, order, attack, target }, origin, false);
    });
  }

  private hitPulse(pulse: Pulse, origin: Point, repeat: boolean): void {
    const { attack, target: primary } = pulse;
    if (primary.hp <= 0 || !this.targets.includes(primary)) return;
    const s = attack.forms, radius = s.area.radius, length = s.pierce.length, width = s.pierce.width;
    const direction = distance(primary, origin) ? norm({ x: primary.x - origin.x, y: primary.y - origin.y }) : { x: -Math.sin(this.angle), y: Math.cos(this.angle) };
    const rarity = higherRarity(attack.rarities.power, higherRarity(attack.rarities.multi, attack.rarities.repeat));
    this.effect('bolt', origin, primary, 0, 1.8 + (attack.damage - this.rules.baseHitDamage) * .5, .32, undefined, rarity, 'electron');
    if (repeat && attack.ranks.repeat) this.activate('repeat', attack.ranks.repeat);
    if (!repeat && pulse.order > 0 && attack.ranks.multi) this.activate('multi', attack.ranks.multi);
    if (radius) { this.effect('area', primary, primary, radius, 1, .38, 'area', attack.rarities.area); this.activate('area', attack.ranks.area); }
    if (length) { this.effect('pierce', origin, { x: origin.x + direction.x * length, y: origin.y + direction.y * length }, 0, width, .3, 'pierce', attack.rarities.pierce, 'electron'); this.activate('pierce', attack.ranks.pierce); }
    const hit = this.targets.filter((t) => {
      if (t.hp <= 0) return false;
      if (t.id === primary.id || (radius > 0 && distance(t, primary) <= radius)) return true;
      if (!length) return false;
      const dx = t.x - origin.x, dy = t.y - origin.y, projection = dx * direction.x + dy * direction.y;
      return projection >= 0 && projection <= length && Math.abs(dx * direction.y - dy * direction.x) <= width / 2;
    }).sort((a, b) => a.id - b.id);
    hit.forEach((t) => this.hit(t, attack.damage, attack));
    let previous: Point = primary;
    const visited = new Set([primary.id]);
    for (let hop = 0; hop < s.chain.hops; hop++) {
      const next = closest(this.targets.filter((t) => t.hp > 0 && !visited.has(t.id) && distance(t, previous) <= s.chain.range), previous)[0];
      if (!next) break;
      this.effect('bolt', previous, next, 0, 1.2, .34, 'chain', attack.rarities.chain);
      this.activate('chain', attack.ranks.chain);
      this.hit(next, attack.damage, attack);
      visited.add(next.id);
      previous = next;
    }
    this.discharge(attack);
  }

  private discharge(attack: Attack): void {
    if (attack.firstKill && attack.ranks.burst && !attack.burstFired) {
      attack.burstFired = true;
      const point = attack.firstKill, radius = attack.forms.burst.radius;
      this.activate('burst', attack.ranks.burst);
      const targets = this.targets.filter(t => t.hp > 0 && distance(t, point) <= radius);
      closest(targets, point).slice(0, attack.forms.burst.count).forEach(t => {
        this.effect('bolt', point, t, 0, 1.4, .14, 'burst', attack.rarities.burst);
        this.hit(t, attack.damage);
      });
    }
  }

  private beginAttack(damage: number): Attack {
    return { id: this.nextAttackId++, ranks: { ...this.ranks }, rarities: { ...this.rarities }, forms: this.forms, damage, burstFired: false };
  }

  private updateSkills(): void {
    for (const id of Object.keys(this.nextSkill) as TimedSkill[]) {
      if (this.nextSkill[id] > this.tick + 1e-8 || (id === 'focus' && this.focus)) continue;
      this.fireSkill(id);
      this.nextSkill[id] = this.tick + this.rules.skills[id].periodSeconds / this.rate * HZ;
    }
    for (const id of ['wave', 'whip'] as const) {
      const cast = this[id];
      if (!cast) continue;
      const progress = Math.min(1, (this.time - cast.born) / this.rules.skills[id].duration);
      const origin = id === 'wave' ? cast.from : this.position;
      for (const target of [...this.targets].sort((a, b) => a.id - b.id)) {
        if (cast.hit.has(target.id)) continue;
        const d = distance(target, origin);
        const form = cast.attack.forms;
        let hit = false;
        if (id === 'wave') {
          hit = d <= form.wave.radius * progress + target.size && d >= form.wave.radius * cast.previous - target.size;
        } else {
          const angle = (Math.atan2(target.y - origin.y, target.x - origin.x) - cast.angle + Math.PI * 4) % (Math.PI * 2);
          const padding = Math.atan2(target.size, Math.max(1, d));
          hit = d <= form.whip.length && angle >= form.whip.arc * cast.previous - padding && angle <= form.whip.arc * progress + padding;
        }
        if (!hit) continue;
        cast.hit.add(target.id);
        this.hit(target, cast.attack.damage, cast.attack);
      }
      this.discharge(cast.attack);
      cast.previous = progress;
      if (progress >= 1) this[id] = null;
    }
    if (this.focus) {
      const cast = this.focus;
      if (this.time >= cast.until - 1e-8) { this.focus = null; return; }
      if (this.tick < cast.next - 1e-8) return;
      const form = cast.attack.forms.focus, origin = this.position;
      if (!cast.target || cast.target.hp <= 0 || !this.targets.includes(cast.target) || distance(cast.target, origin) > form.range) {
        cast.target = closest(this.targets.filter(t => t.hp > 0 && distance(t, origin) <= form.range), origin)[0];
      }
      if (cast.target) {
        this.effect('focus', origin, cast.target, 0, 1.5, this.rules.skills.focus.tickSeconds, 'focus', cast.attack.rarities.focus, 'electron').targetId = cast.target.id;
        this.hit(cast.target, cast.attack.damage, cast.attack);
        this.discharge(cast.attack);
      }
      cast.next += this.rules.skills.focus.tickSeconds * HZ;
    }
  }

  fireSkill(id: TimedSkill, origin: Point = this.position): void {
    if (!this.ranks[id]) return;
    const cfg = this.rules.skills[id];
    const attack = this.beginAttack(this.damage * (id === 'focus' ? this.forms.focus.damage : cfg.damage));
    const form = attack.forms, rarity = attack.rarities[id];
    if (id === 'strike') {
      const selected = this.targets.filter(t => t.hp > 0 && distance(t, origin) <= this.rules.skills.strike.range)
        .sort((a, b) => b.hp - a.hp || distance(a, origin) - distance(b, origin) || a.id - b.id).slice(0, form.strike.count);
      if (!selected.length) return;
      // A target can take one strike per cast, including overlapping impact areas.
      const hit = new Set<number>();
      for (const target of selected) {
        this.effect('strike', { x: target.x, y: target.y - 180 }, target, form.strike.radius, 3, .24, id, rarity);
        for (const nearby of [...this.targets].sort((a, b) => a.id - b.id)) {
          if (nearby.hp <= 0 || hit.has(nearby.id) || distance(nearby, target) > form.strike.radius) continue;
          hit.add(nearby.id); this.hit(nearby, attack.damage, attack);
        }
      }
      this.discharge(attack);
    } else if (id === 'focus') {
      this.focus = { attack, until: this.time + form.focus.duration, next: this.tick };
    } else {
      const target = closest(this.targets.filter(t => t.hp > 0), origin)[0];
      const angle = (target ? Math.atan2(target.y - origin.y, target.x - origin.x) : this.angle + Math.PI / 2) - form.whip.arc / 2;
      this[id] = { attack, from: { ...origin }, born: this.time, previous: 0, hit: new Set(), angle };
      // For a whip, `to` is its initial direction and `width` is the swept angle.
      this.effect(id, origin, { x: origin.x + Math.cos(angle), y: origin.y + Math.sin(angle) },
        id === 'wave' ? form.wave.radius : form.whip.length, id === 'wave' ? 1 : form.whip.arc,
        this.rules.skills[id].duration, id, rarity, id === 'whip' ? 'electron' : undefined);
    }
    this.activate(id);
  }

  private hit(target: Target, damage: number, attack?: Attack): void {
    if (target.hp <= 0 || !this.targets.includes(target)) return;
    target.hp -= damage;
    if (target.hp < 1e-8) target.hp = 0;
    target.hitAt = this.time;
    this.log('hit', { id: target.id, kind: target.kind, damage });
    this.damageNumbers.push({ id: this.nextDamageId++, x: target.x, y: target.y, value: damage, born: this.seconds, rarity: attack?.rarities.power ?? this.rarities.power });
    if (this.damageNumbers.length > maxDamageNumbers) this.damageNumbers.splice(0, this.damageNumbers.length - maxDamageNumbers);
    if (target.hp <= 0) {
      if (attack && !attack.firstKill) attack.firstKill = { x: target.x, y: target.y };
      this.counts[target.kind].killed++;
      this.targets = this.targets.filter((t) => t.id !== target.id);
      this.effect('kill', target, this.position, 8, damage, .4);
      const before = this.charged;
      const previous = this.level;
      this.xp += target.xp;
      this.levelUp(previous);
      this.score += Math.round(target.xp * 10 * (1 + target.radius / this.rules.spawnRadius));
      this.kills.push({ tick: this.tick, energy: target.xp });
      this.kills = this.kills.filter((kill) => this.tick - kill.tick < this.rules.rush.windowSeconds * HZ);
      if (this.kills.reduce((sum, kill) => sum + kill.energy, 0) >= this.rules.rush.energyThreshold) {
        this.rushUntil = this.tick + this.rules.rush.windowSeconds * HZ;
        if (this.rushing) this.nextSpawn = Math.min(this.nextSpawn, this.tick + this.rules.rush.spawnSecondsByStage[this.stage] * HZ);
      }
      this.log('kill', { id: target.id, kind: target.kind, xp: this.xp });
      if (!before && this.charged) this.log('charged', { xp: this.xp });
    }
  }

  private collide(trigger: 'gravity' | 'final'): void {
    this.endingOutcome = this.charged ? 'success' : 'collapse-failure';
    this.collisionTime = this.time;
    this.collisionTrigger = trigger;
    this.phase = 'collapse';
    this.phaseTicks = 0;
    this.choice = null;
    this.pulses = [];
    this.wave = null; this.whip = null; this.focus = null;
    this.damageNumbers = [];
    this.log('collision', { trigger, outcome: this.endingOutcome, xp: this.xp, mass: this.mass, radius: this.radius });
  }

  private finishResult(): void {
    this.phase = 'result';
    this.result = {
      outcome: this.endingOutcome, trigger: this.collisionTrigger,
      xp: this.xp, mass: this.mass, radius: this.radius, level: this.level, speed: this.speed,
      missingXp: Math.max(0, this.rules.energyGoal - this.xp), seed: this.seed,
      ranks: { ...this.ranks }, boosts: { ...this.boosts }, seconds: this.seconds,
      rarities: { ...this.rarities }, score: this.score, rushSpawns: this.rushSpawns,
      collisionTime: this.collisionTime, waves: this.waveCount,
      counts: { small: { ...this.counts.small, remaining: this.targets.filter((t) => t.kind === 'small').length }, dense: { ...this.counts.dense, remaining: this.targets.filter((t) => t.kind === 'dense').length } },
      selections: [...this.selections], metrics: { ...this.metrics },
    };
    this.log('result', this.result.outcome);
  }

  private effect(kind: Effect['kind'], from: Point, to: Point, radius: number, width: number, life: number, source?: SkillId, rarity: Rarity = source ? this.rarities[source] : 'common', anchor?: Effect['anchor']): Effect {
    if (kind === 'bolt' || kind === 'pierce') life = .14;
    const effect = { kind, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, radius, width, born: this.seconds, life, source, rarity, anchor };
    this.effects.push(effect);
    if (this.effects.length > 160) {
      const discard = this.effects.findIndex(fx => ['kill', 'absorb', 'area'].includes(fx.kind));
      this.effects.splice(Math.max(0, discard), 1);
    }
    this.metrics.maxEffects = Math.max(this.metrics.maxEffects, this.effects.length);
    return effect;
  }
  private activate(id: SkillId, rank = this.ranks[id]): void {
    this.skillActivations[id] ??= this.time;
    this.log('skill-effect', { id, rank });
  }
  private log(kind: string, data: unknown): void { this.events.push({ time: this.time, kind, data }); }
}

