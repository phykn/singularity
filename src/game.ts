import { blankBoosts, blankRanks, blankRarities, coreRadius, formValues, higherRarity, isSkill, orbitTarget, rarityIds, rarityScale, rollRarity, rules, skillIds, statIds } from './rules.ts';
import type { Boosts, Card, FormValues, Ranks, Rarities, Rarity, SkillId, UpgradeId } from './rules.ts';

const HZ = rules.tickRate;
const CENTER = { x: 180, y: 260 };
export type Point = { x: number; y: number };
export type TargetKind = 'small' | 'dense';
export type Phase = 'ready' | 'running' | 'collapse' | 'ending' | 'result';
export type Target = Point & { id: number; kind: TargetKind; hp: number; maxHp: number; xp: number; mass: number; size: number; radius: number; angle: number; speed: number; turn: number; hitAt?: number; trailHit?: number };
export type Mark = Point & { radius: number; rank: number; rarity: Rarity; damage: number; expires: number };
export type Effect = { kind: 'bolt' | 'area' | 'pierce' | 'burst' | 'kill' | 'level' | 'absorb'; from: Point; to: Point; radius: number; width: number; born: number; life: number; source?: SkillId; rarity: Rarity };
export const maxDamageNumbers = 64;
export type DamageNumber = Point & { id: number; value: number; born: number; rarity: Rarity };
export type Choice = { cards: Card[]; number: number; opened: number; deadline: number };
export type Count = { generated: number; killed: number; absorbed: number };
export type Outcome = 'success' | 'collapse-failure';
export type Selection = { time: number; id: UpgradeId; rank: number; rarity: Rarity; automatic: boolean };
export type Metrics = { minRadius: number; minMargin: number; dangerSeconds: number; maxTargets: number; maxEffects: number };
export type Result = { version: number; outcome: Outcome; trigger: 'gravity' | 'final'; xp: number; mass: number; radius: number; level: number; speed: number; missingXp: number; seed: number; ranks: Ranks; boosts: Boosts; rarities: Rarities; score: number; rushSpawns: number; seconds: number; collisionTime: number; waves: number; counts: Record<TargetKind, Count & { remaining: number }>; selections: Selection[]; metrics: Metrics };
type Attack = { id: number; ranks: Ranks; rarities: Rarities; forms: FormValues; damage: number; burstFired: boolean; firstKill?: Point };
type Pulse = { at: number; order: number; attack: Attack; target: Target };
export type Event = { time: number; kind: string; data: unknown };
export type Checkpoint = { version: number; seed: number; ticks: number; phase: Exclude<Phase, 'ready'>; manualPaused: boolean; inputs: { tick: number; id: UpgradeId; number: number }[] };

export class Random {
  state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let n = Math.imul(this.state ^ this.state >>> 15, this.state | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  }
  shuffle<T>(input: T[]): T[] {
    const items = [...input];
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

export function eligibleSkills(ranks: Ranks): SkillId[] {
  const owned = skillIds.filter((id) => ranks[id] > 0).length;
  return skillIds.filter((id) => ranks[id] < rules.maxSkillRank && (ranks[id] > 0 || owned < rules.skillSlots));
}

export function eligibleUpgrades(ranks: Ranks, boosts: Boosts): UpgradeId[] {
  return [...eligibleSkills(ranks), ...statIds.filter((id) => boosts[id] < rules.maxSkillRank)];
}

type CardState = { ranks: Ranks; boosts: Boosts; number: number; danger: boolean };
export function makeCards(state: CardState, random: Random): UpgradeId[] {
  const { ranks, boosts, number, danger } = state;
  const pool = random.shuffle(eligibleUpgrades(ranks, boosts));
  if (pool.length < rules.choiceCount) throw new Error('Not enough valid growth cards');
  if (number === 1) {
    const forms = pool.filter(isSkill), cards = forms.slice(0, rules.choiceCount);
    const broad = (id: SkillId) => ['area', 'chain', 'multi'].includes(id);
    const auto = cards.find(broad) ?? forms.find(broad)!;
    if (!cards.includes(auto)) cards[2] = auto;
    return [auto, ...cards.filter((id) => id !== auto)];
  }
  const forms = pool.filter(isSkill), owned = skillIds.filter((id) => ranks[id] > 0);
  const existing = forms.filter((id) => ranks[id] > 0).sort((a, b) => ranks[a] - ranks[b]);
  const fresh = forms.find((id) => ranks[id] === 0);
  const form = owned.length < 2 ? fresh ?? existing[0] : existing[0] ?? fresh;
  const stat = statIds.filter((id) => pool.includes(id)).sort((a, b) => boosts[a] - boosts[b])[0];
  const auto = danger && boosts.accel < rules.maxSkillRank ? 'accel' : number % 2 ? form ?? stat : stat ?? form;
  const cards: UpgradeId[] = [auto];
  const add = (id: UpgradeId | undefined) => { if (id && !cards.includes(id) && cards.length < rules.choiceCount) cards.push(id); };
  add(isSkill(auto) ? pool.find((id) => !isSkill(id)) : pool.find(isSkill));
  pool.forEach(add);
  return cards;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (p: Point): Point => { const d = Math.hypot(p.x, p.y); return { x: p.x / d, y: p.y / d }; };
const closest = (targets: Target[], point: Point) => [...targets].sort((a, b) => distance(a, point) - distance(b, point) || a.id - b.id);
export const orbitRadius = rules.orbitRadius;
export const orbit = (angle: number, radius = orbitRadius): Point => ({ x: CENTER.x + radius * Math.cos(angle), y: CENTER.y + radius * Math.sin(angle) });

export class Game {
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
  marks: Mark[] = [];
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
  private nextSatellite = Infinity;
  private nextMark = Infinity;
  private nextTrailTick = Infinity;
  private batchCount = 0;
  private nextTargetId = 0;
  private nextAttackId = 0;
  private nextDamageId = 0;
  private pulses: Pulse[] = [];
  private remainder = 0;
  private endingOutcome: Outcome = 'collapse-failure';

  constructor(seed: number, options: { combat?: boolean } = {}) {
    this.seed = seed >>> 0;
    this.randomSpawn = new Random(this.seed ^ 0x9E3779B9);
    this.randomCards = new Random(this.seed ^ 0xC2B2AE35);
    this.randomRarity = new Random(this.seed ^ 0x27D4EB2F);
    const waveRandom = new Random(this.seed ^ 0xA511E9B3);
    this.waves = rules.waves.map((time) => ({ time, angle: waveRandom.next() * Math.PI * 2 }));
    this.combat = options.combat ?? true;
  }

  get time(): number { return this.tick / HZ; }
  get seconds(): number { return this.elapsedTicks / HZ; }
  get level(): number { return 1 + rules.levelXp.filter((xp) => this.xp >= xp).length; }
  get speed(): number { return rules.baseSpeed * (1 + rules.speedPerRank * this.boosts.accel * rarityScale(this.rarities.accel)); }
  get damage(): number { return rules.baseHitDamage + rules.damagePerRank * this.boosts.power * rarityScale(this.rarities.power); }
  get rate(): number { return 1 + rules.ratePerRank * this.boosts.rate * rarityScale(this.rarities.rate); }
  get forms(): FormValues { return formValues(this.ranks, this.rarities); }
  get rushing(): boolean { return this.phase === 'running' && this.tick < this.rushUntil && this.targets.length < rules.rush.maxTargets; }
  get attackInterval(): number { return rules.attackBaseSeconds / this.rate; }
  get core(): number { return coreRadius(this.mass); }
  get targetRadius(): number { return orbitTarget(this.mass, this.boosts.accel * rarityScale(this.rarities.accel)); }
  get margin(): number { return this.radius - this.core - rules.electronRadius; }
  get charged(): boolean { return this.xp >= rules.energyGoal; }
  get paused(): boolean { return this.manualPaused || this.hiddenPaused; }
  get position(): Point { return orbit(this.angle, this.radius); }
  get stage(): number { return Math.max(0, rules.stageEnds.findIndex((end) => this.time < end)); }
  get nextXp(): number | undefined { return rules.levelXp[this.level - 1]; }
  get levelProgress(): { current: number; required: number } {
    const previous = rules.levelXp[this.level - 2] ?? 0;
    return { current: this.xp - previous, required: (this.nextXp ?? previous) - previous };
  }
  get upcomingWave() { return this.waves[this.waveCount]; }
  get warningWave() { const wave = this.upcomingWave; return this.phase === 'running' && wave && wave.time - this.time <= rules.waveWarningSeconds ? wave : null; }
  get phaseProgress(): number { return this.phaseTicks / (HZ * (this.phase === 'collapse' ? rules.collisionSeconds : this.successfulEnding ? rules.successEndingSeconds : rules.failureEndingSeconds)); }
  get successfulEnding(): boolean { return this.endingOutcome === 'success'; }
  rank(id: UpgradeId): number { return isSkill(id) ? this.ranks[id] : this.boosts[id]; }

  start(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'running';
    this.log('start', { seed: this.seed });
    if (this.combat) { this.spawnBatch(); this.nextSpawn = rules.spawnSeconds * HZ; }
  }
  setManualPause(paused: boolean): void { this.manualPaused = paused; }
  setHidden(paused: boolean): void { this.hiddenPaused = paused; }

  checkpoint(): Checkpoint | null {
    if (this.phase === 'ready' || !this.combat) return null;
    return {
      version: rules.designVersion, seed: this.seed, ticks: this.elapsedTicks, phase: this.phase, manualPaused: this.manualPaused,
      inputs: this.selections.flatMap((selection, i) => selection.automatic ? [] : [{ tick: Math.round(selection.time * HZ), id: selection.id, number: i + 1 }]),
    };
  }

  static restore(checkpoint: Checkpoint): Game | null {
    if (checkpoint.version !== rules.designVersion) return null;
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
    if (this.tick >= rules.growthSeconds * HZ) { this.collide('final'); return; }
    if (this.choice && this.time >= this.choice.deadline) this.select(this.choice.cards[0].id, true);
    if (this.combat && this.tick + 1e-8 >= this.nextSpawn) {
      const rushing = this.rushing;
      this.spawnBatch();
      if (rushing) { this.rushSpawns++; this.log('rush', { count: this.rushSpawns }); }
      this.nextSpawn += (rushing ? rules.rush.spawnSeconds : rules.spawnSeconds) * HZ;
    }
    const wave = this.upcomingWave;
    if (wave && this.time >= wave.time) {
      if (this.combat) {
        this.spawnGroup('small', rules.waveSmall / 2, wave.angle, 1);
        this.spawnGroup('small', rules.waveSmall / 2, wave.angle + Math.PI, -1);
        this.spawnGroup('dense', 1, wave.angle + .15, 1);
        this.spawnGroup('dense', 1, wave.angle + Math.PI + .15, -1);
      }
      this.waveCount++;
      this.log('wave', { number: this.waveCount, angle: wave.angle });
    }
    this.moveTargets();
    this.angle += this.speed / this.radius / HZ;
    this.marks = this.marks.filter((mark) => mark.expires > this.time);
    const due = this.pulses.filter((p) => p.at <= this.tick + 1e-8).sort((a, b) => a.attack.id - b.attack.id || a.order - b.order);
    this.pulses = this.pulses.filter((p) => p.at > this.tick + 1e-8);
    due.forEach((pulse) => this.hitPulse(pulse, this.position, true));
    if (this.nextTrailTick <= this.tick + 1e-8) { this.damageTrails(); this.nextTrailTick += rules.skills.trail.tickSeconds * HZ; }
    if (this.combat && this.tick + 1e-8 >= this.nextAttack) { this.fireBasic(); this.nextAttack += this.attackInterval * HZ; }
    if (this.nextSatellite <= this.tick + 1e-8) { this.fireSatellites(); this.nextSatellite += rules.skills.satellite.periodSeconds / this.rate * HZ; }
    if (this.nextMark <= this.tick + 1e-8) { this.leaveTrail(); this.nextMark += rules.skills.trail.markSeconds * HZ; }
    this.absorbTargets();
    this.updateOrbit();
    this.metrics.minRadius = Math.min(this.metrics.minRadius, this.radius);
    this.metrics.minMargin = Math.min(this.metrics.minMargin, this.margin);
    if (this.margin > 0 && this.margin < rules.dangerMargin && !this.charged) this.metrics.dangerSeconds += 1 / HZ;
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
    this.radius += Math.sign(change) * Math.min(Math.abs(change), (change < 0 ? rules.inwardSpeed : rules.outwardSpeed) / HZ);
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
    const danger = this.margin < rules.dangerMargin;
    const cards = makeCards({ ranks: this.ranks, boosts: this.boosts, number, danger }, this.randomCards)
      .map((id) => ({ id, rarity: higherRarity(this.rarities[id], rollRarity(this.randomRarity.next())) }));
    if (!(danger && cards[0].id === 'accel')) {
      const best = cards.reduce((a, b) => rarityIds.indexOf(b.rarity) > rarityIds.indexOf(a.rarity) ? b : a);
      if (rarityIds.indexOf(best.rarity) - rarityIds.indexOf(cards[0].rarity) >= 2) cards.unshift(...cards.splice(cards.indexOf(best), 1));
    }
    this.choice = { cards, number, opened: this.time, deadline: (this.tick + rules.choiceSeconds * HZ) / HZ };
    this.log('cards', { number, cards });
  }

  select(id: UpgradeId, automatic = false, choiceNumber = this.choice?.number): boolean {
    if (this.paused || this.phase !== 'running' || !this.choice || choiceNumber !== this.choice.number) return false;
    const card = this.choice.cards.find((card) => card.id === id);
    if (!card) return false;
    if (!automatic && this.time >= this.choice.deadline) return false;
    if (!eligibleUpgrades(this.ranks, this.boosts).includes(id)) return false;
    const previous = this.rank(id), oldRate = this.rate;
    this.rarities[id] = higherRarity(this.rarities[id], card.rarity);
    if (isSkill(id)) this.ranks[id]++; else this.boosts[id]++;
    if (id === 'rate') {
      const ratio = oldRate / this.rate;
      this.nextAttack = this.tick + Math.max(0, this.nextAttack - this.tick) * ratio;
      if (Number.isFinite(this.nextSatellite)) this.nextSatellite = this.tick + Math.max(0, this.nextSatellite - this.tick) * ratio;
    }
    const selection = { time: this.time, id, rank: this.rank(id), rarity: this.rarities[id], automatic };
    this.selections.push(selection);
    this.log('skill', selection);
    this.effect('level', this.position, this.position, id === 'accel' ? 30 : 18, 1, .5, undefined, this.rarities[id]);
    this.notice = id;
    this.noticeUntil = this.time + 1.5;
    if (id === 'satellite' && previous === 0) this.nextSatellite = this.tick + rules.skills.satellite.periodSeconds / this.rate * HZ;
    if (id === 'trail' && previous === 0) {
      this.leaveTrail();
      this.nextMark = this.tick + rules.skills.trail.markSeconds * HZ;
      this.nextTrailTick = this.tick + rules.skills.trail.tickSeconds * HZ;
    }
    this.choice = null;
    this.openChoice();
    return true;
  }

  spawnBatch(): void {
    const roll = this.randomSpawn.next(), angle = this.randomSpawn.next() * Math.PI * 2, direction = this.randomSpawn.next() < .5 ? -1 : 1;
    const intro = this.batchCount < rules.introBatches;
    const kind = intro || roll < rules.smallBatchProbabilityByStage[this.stage] ? 'small' : 'dense';
    this.spawnGroup(kind, kind === 'small' ? rules.smallBatchSize : rules.denseBatchSize, intro ? this.angle + .35 : angle, direction);
    this.batchCount++;
  }

  private spawnGroup(kind: TargetKind, count: number, angle: number, direction: number): void {
    const data = rules.targets[kind];
    const planned = [];
    for (let i = 0; i < count; i++) {
      const theta = angle + (i - (count - 1) / 2) * (kind === 'small' ? .095 : .46);
      const hp = data.hp[this.stage], id = this.nextTargetId++;
      const target: Target = { id, ...orbit(theta, rules.spawnRadius), angle: theta, radius: rules.spawnRadius, kind, hp, maxHp: hp, xp: data.xp, mass: data.mass, size: data.size, speed: data.speed, turn: data.turn * direction };
      this.targets.push(target);
      this.counts[kind].generated++;
      planned.push({ id, kind, angle: theta, hp });
    }
    this.metrics.maxTargets = Math.max(this.metrics.maxTargets, this.targets.length);
    this.log('spawn', { planned });
  }

  fireBasic(origin: Point = this.position): void {
    const forms = this.forms;
    const selected = closest(this.targets.filter((t) => t.hp > 0 && distance(t, origin) <= rules.primaryRange), origin).slice(0, forms.multi.count);
    if (!selected.length) return;
    const attack: Attack = { id: this.nextAttackId++, ranks: { ...this.ranks }, rarities: { ...this.rarities }, forms, damage: this.damage, burstFired: false };
    selected.forEach((target, order) => {
      for (let hit = 1; hit < forms.repeat.hits; hit++) this.pulses.push({ at: this.tick + hit * rules.skills.repeat.delaySeconds * HZ, order, attack, target });
      this.hitPulse({ at: this.tick, order, attack, target }, origin, false);
    });
  }

  private hitPulse(pulse: Pulse, origin: Point, repeat: boolean): void {
    const { attack, target: primary } = pulse;
    if (primary.hp <= 0 || !this.targets.includes(primary)) return;
    const s = attack.forms, radius = s.area.radius, length = s.pierce.length, width = s.pierce.width;
    const direction = distance(primary, origin) ? norm({ x: primary.x - origin.x, y: primary.y - origin.y }) : { x: -Math.sin(this.angle), y: Math.cos(this.angle) };
    const rarity = higherRarity(attack.rarities.power, higherRarity(attack.rarities.multi, attack.rarities.repeat));
    this.effect('bolt', origin, primary, 0, 1.8 + (attack.damage - rules.baseHitDamage) * .5, .32, undefined, rarity);
    if (repeat && attack.ranks.repeat) this.activate('repeat', attack.ranks.repeat);
    if (!repeat && pulse.order > 0 && attack.ranks.multi) this.activate('multi', attack.ranks.multi);
    if (radius) { this.effect('area', primary, primary, radius, 1, .38, 'area', attack.rarities.area); this.activate('area', attack.ranks.area); }
    if (length) { this.effect('pierce', origin, { x: origin.x + direction.x * length, y: origin.y + direction.y * length }, 0, width, .3, 'pierce', attack.rarities.pierce); this.activate('pierce', attack.ranks.pierce); }
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
    if (attack.firstKill && attack.ranks.burst && !attack.burstFired) {
      attack.burstFired = true;
      const point = attack.firstKill, radius = s.burst.radius;
      this.effect('burst', point, point, radius, 1.5, .35, 'burst', attack.rarities.burst);
      this.activate('burst', attack.ranks.burst);
      this.targets.filter((t) => t.hp > 0 && distance(t, point) <= radius).sort((a, b) => a.id - b.id).forEach((t) => this.hit(t, attack.damage));
    }
  }

  fireSatellites(origin: Point = this.position): void {
    const count = this.forms.satellite.count;
    for (let i = 0; i < count; i++) {
      const target = closest(this.targets.filter((t) => t.hp > 0 && distance(t, origin) <= rules.skills.satellite.range), origin)[0];
      if (!target) break;
      this.effect('bolt', origin, target, 0, 1.4, .3, 'satellite');
      this.activate('satellite');
      this.hit(target, this.damage);
    }
  }

  leaveTrail(origin: Point = this.position): void {
    const rank = this.ranks.trail;
    if (rank) this.marks.push({ ...origin, rank, rarity: this.rarities.trail, damage: this.damage, radius: this.forms.trail.radius, expires: this.time + this.forms.trail.lifetime });
  }

  damageTrails(): void {
    for (const t of [...this.targets].sort((a, b) => a.id - b.id)) {
      if (t.hp <= 0 || (t.trailHit !== undefined && this.time - t.trailHit < rules.skills.trail.targetCooldownSeconds - 1e-8)) continue;
      const marks = this.marks.filter((m) => m.expires > this.time && distance(t, m) <= m.radius);
      if (!marks.length) continue;
      t.trailHit = this.time;
      this.activate('trail', Math.max(...marks.map((m) => m.rank)));
      const rarity = marks.reduce((best, mark) => higherRarity(best, mark.rarity), 'common' as Rarity);
      this.effect('area', t, t, 5, 1, .2, 'trail', rarity);
      this.hit(t, Math.max(...marks.map((m) => m.damage)));
    }
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
      this.score += Math.round(target.xp * 10 * (1 + target.radius / rules.spawnRadius));
      this.kills.push({ tick: this.tick, energy: target.xp });
      this.kills = this.kills.filter((kill) => this.tick - kill.tick < rules.rush.windowSeconds * HZ);
      if (this.kills.reduce((sum, kill) => sum + kill.energy, 0) >= rules.rush.energyThreshold) {
        this.rushUntil = this.tick + rules.rush.windowSeconds * HZ;
        if (this.rushing) this.nextSpawn = Math.min(this.nextSpawn, this.tick + rules.rush.spawnSeconds * HZ);
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
    this.marks = [];
    this.damageNumbers = [];
    this.log('collision', { trigger, outcome: this.endingOutcome, xp: this.xp, mass: this.mass, radius: this.radius });
  }

  private finishResult(): void {
    this.phase = 'result';
    this.result = {
      version: rules.designVersion, outcome: this.endingOutcome, trigger: this.collisionTrigger,
      xp: this.xp, mass: this.mass, radius: this.radius, level: this.level, speed: this.speed,
      missingXp: Math.max(0, rules.energyGoal - this.xp), seed: this.seed,
      ranks: { ...this.ranks }, boosts: { ...this.boosts }, seconds: this.seconds,
      rarities: { ...this.rarities }, score: this.score, rushSpawns: this.rushSpawns,
      collisionTime: this.collisionTime, waves: this.waveCount,
      counts: { small: { ...this.counts.small, remaining: this.targets.filter((t) => t.kind === 'small').length }, dense: { ...this.counts.dense, remaining: this.targets.filter((t) => t.kind === 'dense').length } },
      selections: [...this.selections], metrics: { ...this.metrics },
    };
    this.log('result', this.result.outcome);
  }

  private effect(kind: Effect['kind'], from: Point, to: Point, radius: number, width: number, life: number, source?: SkillId, rarity: Rarity = source ? this.rarities[source] : 'common'): void {
    this.effects.push({ kind, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, radius, width, born: this.seconds, life, source, rarity });
    if (this.effects.length > 160) this.effects.splice(0, this.effects.length - 160);
    this.metrics.maxEffects = Math.max(this.metrics.maxEffects, this.effects.length);
  }
  private activate(id: SkillId, rank = this.ranks[id]): void {
    this.skillActivations[id] ??= this.time;
    this.log('skill-effect', { id, rank });
  }
  private log(kind: string, data: unknown): void { this.events.push({ time: this.time, kind, data }); }
}

