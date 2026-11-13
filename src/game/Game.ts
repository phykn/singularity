import { strikeBeat } from './beats.ts';
import { Combat } from './combat.ts';
import type { Event, EventKind, Events } from './events.ts';
import { CENTER, distance, orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import { Giants } from './giants.ts';
import { Growth } from './growth.ts';
import { particleMotion } from './particles.ts';
import { Random } from './random.ts';
import { rules as defaultRules, rulesHash } from './rules.ts';
import type { BossKind, PopStyle, Rules, UpgradeId } from './rules.ts';
import { Spawner } from './spawn.ts';
import type {
  BannerKind,
  Beat,
  DamageNumber,
  Effect,
  EffectInput,
  Input,
  Outcome,
  Phase,
  Result,
  RunRecord,
  Target,
  Trigger,
} from './types.ts';

export const damageNumberSeconds = 0.72;
const maxDamageNumbers = 64,
  maxEffects = 160;

// One run: a seeded simulation advanced in fixed ticks. It owns the clock, the phases, the
// orbit and the core, the particles on the field and what the views read; arrivals, giants,
// growth and combat each have their own class.
export class Game {
  readonly rules: Rules;
  readonly seed: number;
  // Off in tests that place their own targets: no regular arrivals and no basic fire.
  readonly combatEnabled: boolean;
  readonly spawner: Spawner;
  readonly giants: Giants;
  readonly growth: Growth;
  readonly combat: Combat;
  phase: Phase = 'ready';
  // Running combat ticks; `elapsedTicks` also counts phase transitions.
  tick = 0;
  elapsedTicks = 0;
  phaseTicks = 0;
  pendingTicks = 0;
  mass = 0;
  radius: number;
  angle = -Math.PI / 2;
  targets: Target[] = [];
  nextId = 0;
  banner: { kind: BannerKind; until: number; boss?: BossKind } | null = null;
  effects: Effect[] = [];
  damageNumbers: DamageNumber[] = [];
  events: Event[] = [];
  // Events trimmed from the front of the log.
  eventOffset = 0;
  inputs: Input[] = [];
  result: Result | null = null;
  // The cleared run, kept while endless mode runs past it.
  clearResult: Result | null = null;
  outcome: Outcome = 'collapse-failure';
  trigger: Trigger = 'gravity';
  collisionTime = 0;
  // The tick of the last accepted beat; a second tap in one tick is ignored.
  beatTick = -1;
  private readonly recordEvents: boolean;
  // Seeded apart so critical rolls never shift spawns or cards.
  readonly crit: Random;
  private beyondTick = 0;
  private criticalEntered = false;
  private orbitRecovery = 0;
  private nextDamageId = 0;
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
    this.crit = stream('crit');
    this.spawner = new Spawner(this, stream('spawn'), stream('wave'));
    this.giants = new Giants(this);
    this.growth = new Growth(this, stream('cards'), stream('rarity'));
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
  get position(): Point {
    return orbit(this.angle, this.radius);
  }
  get core(): number {
    const o = this.rules.orbit;
    return o.coreRadius + Math.min(o.coreGrowthMax, o.coreGrowth * this.mass);
  }
  // Mass pulls the orbit inward; the critical breach pulls it `critical.pull` further.
  get targetRadius(): number {
    const o = this.rules.orbit,
      radius = Math.max(0, Math.min(o.radius, o.radius - o.gravityPerMass * this.mass));
    return this.critical ? Math.max(0, radius - this.rules.critical.pull) : radius;
  }
  get margin(): number {
    return this.radius - this.core - this.rules.orbit.electronRadius;
  }
  get danger(): boolean {
    return this.margin < this.rules.orbit.dangerMargin;
  }
  get critical(): boolean {
    return !this.endless && this.time >= this.rules.critical.time;
  }
  get endless(): boolean {
    return this.clearResult !== null;
  }
  get endlessSeconds(): number {
    return this.endless ? (this.tick - this.beyondTick) / this.rules.time.tickRate : 0;
  }
  get canContinue(): boolean {
    return this.phase === 'result' && this.result?.outcome === 'success' && !this.endless;
  }
  // Late particles grow tougher and faster by the minute after the last stage starts. Endless
  // mode keeps the clear's strength and multiplies it once per round cleared.
  get enemyStrength(): { hp: number; speed: number } {
    const { late, endless, critical, stages } = this.rules,
      time = this.clearResult?.collisionTime ?? this.time,
      minutes = Math.max(0, (time - stages.at(-1)!.start) / 60),
      hp = 1 + minutes * late.hpPerMinute,
      speed = Math.min(late.maxSpeedScale, 1 + minutes * late.speedPerMinute);
    if (this.endless) {
      const steps = this.giants.endlessRounds;
      return {
        hp: hp * endless.roundHpMultiplier ** Math.min(steps, 600),
        speed: speed * Math.min(endless.maxSpeedScale, 1 + steps * endless.roundSpeedStep),
      };
    }
    return this.critical
      ? { hp: hp * critical.hpScale, speed: speed * critical.speedScale }
      : { hp, speed };
  }
  // How far the current transition has run, from 0 to 1.
  get phaseProgress(): number {
    const t = this.rules.time,
      seconds =
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

  start(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'running';
    this.log('start', { seed: this.seed });
    if (this.combatEnabled) this.spawner.start();
  }

  // The four inputs land between ticks and are recorded for replay; each reports whether
  // the run accepted it.

  // Takes a card on offer; stale or unknown picks do nothing.
  choose(id: UpgradeId, number: number): boolean {
    const choice = this.growth.choice,
      card = choice?.cards.find((c) => c.id === id);
    if (this.phase !== 'running' || choice?.number !== number || !card) return false;
    if (!this.growth.canUpgrade(id)) return false;
    this.inputs.push({ tick: this.elapsedTicks, kind: 'card', id, number });
    this.growth.take(card);
    return true;
  }

  // An accepted beat strikes; the third also sheds `finishMass`. Beat 0 is a missed beat,
  // which matters only to the Pulse pact.
  resonate(beat: Beat): boolean {
    if (this.phase !== 'running' || this.growth.choice || this.beatTick === this.elapsedTicks)
      return false;
    this.beatTick = this.elapsedTicks;
    this.inputs.push({ tick: this.elapsedTicks, kind: 'beat', beat });
    this.log('resonance', { beat });
    const pacts = this.growth.pacts;
    if (beat === 0) {
      if (pacts.pulse) this.mass += this.rules.pacts.pulse.missMass;
      return true;
    }
    strikeBeat(this.combat, beat);
    // Overclock gives up mass release, this one included.
    if (beat === 3 && !pacts.overclock) this.releaseMass(this.rules.combat.resonance.finishMass);
    return true;
  }

  // Past a clear: the core, orbit and field reset and round seven begins; the build stays.
  continueBeyond(): boolean {
    if (!this.canContinue) return false;
    this.inputs.push({ tick: this.elapsedTicks, kind: 'beyond' });
    this.clearResult = this.result;
    this.result = null;
    this.phase = 'crossing';
    this.phaseTicks = this.pendingTicks = 0;
    this.mass = this.orbitRecovery = this.growth.remainder = 0;
    this.radius = this.rules.orbit.radius;
    this.growth.choice = this.banner = null;
    this.targets = [];
    this.effects = [];
    this.damageNumbers = [];
    this.combat.clear();
    this.spawner.beyond();
    this.giants.beyond();
    this.beyondTick = this.tick;
    this.log('beyond', { round: this.giants.round });
    return true;
  }

  // Ends an endless run where it stands; the result keeps what was gained beyond.
  retire(): boolean {
    if (!this.endless || (this.phase !== 'running' && this.phase !== 'crossing')) return false;
    this.inputs.push({ tick: this.elapsedTicks, kind: 'retire' });
    this.outcome = 'retired';
    this.trigger = 'quit';
    this.collisionTime = this.time;
    this.growth.choice = null;
    this.combat.clear();
    this.finish();
    return true;
  }

  // Wall-clock milliseconds into whole ticks, at most `tickLimit` of them. With
  // `holdAtChoice`, combat stops as soon as cards are on offer.
  advance(milliseconds: number, tickLimit = Infinity, holdAtChoice = false): void {
    if (this.phase === 'ready' || this.phase === 'result') return;
    this.pendingTicks += (milliseconds * this.rules.time.tickRate) / 1000;
    const count = Math.min(Math.floor(this.pendingTicks + 1e-8), tickLimit);
    this.pendingTicks -= count;
    this.run(count, holdAtChoice);
    if (holdAtChoice && this.growth.choice) this.pendingTicks = 0;
  }

  // Up to `ticks` fixed steps, stopping at the result.
  run(ticks: number, holdAtChoice = false): void {
    for (
      let i = 0;
      i < ticks &&
      this.phase !== 'result' &&
      this.phase !== 'ready' &&
      !(holdAtChoice && this.growth.choice);
      i++
    ) {
      this.elapsedTicks++;
      if (this.phase === 'running') this.step();
      else this.transition();
      const now = this.seconds;
      this.effects = this.effects.filter((fx) => now < fx.born + fx.life);
      this.damageNumbers = this.damageNumbers.filter((d) => now < d.born + damageNumberSeconds);
    }
  }

  private step(): void {
    this.tick++;
    if (this.giants.higgsDown) return this.collapse('boss');
    this.giants.arrive();
    if (!this.criticalEntered && this.critical) {
      this.criticalEntered = true;
      this.log('critical', { time: this.time });
      this.banner = { kind: 'critical', until: this.time + this.rules.time.bannerSeconds };
    }
    if (this.combatEnabled) this.spawner.update();
    this.moveTargets();
    this.giants.act();
    this.angle += this.rules.orbit.speed / this.radius / this.rules.time.tickRate;
    this.combat.update();
    this.combat.pacts.horizon();
    if (this.giants.higgsDown) return this.collapse('boss');
    if (this.absorbTargets()) return this.collapse('boss-absorbed');
    if (this.giants.feeding) this.mass++;
    this.updateOrbit();
    if (this.margin <= 0) this.collapse('gravity');
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
    } else this.finish();
  }

  private moveTargets(): void {
    const tickRate = this.rules.time.tickRate;
    for (const t of this.targets) {
      const motion = particleMotion(this.rules.particles[t.particle], this.time - t.born),
        boss = this.giants.phase(t)?.speed ?? 1;
      t.radius = Math.max(0, t.radius - (t.speed * motion.speed * boss) / tickRate);
      t.angle += (t.turn * motion.turn) / tickRate;
      Object.assign(t, orbit(t.angle, t.radius));
    }
  }

  // Missed particles feed the core; reports whether the Higgs reached it.
  private absorbTargets(): boolean {
    const core = this.core,
      absorbed = this.targets
        .filter((t) => t.hp > 0 && t.radius <= core + t.size)
        .sort((a, b) => a.id - b.id);
    for (const t of absorbed) {
      this.mass += t.mass;
      if (t.kind === 'boss') {
        this.log('boss-absorbed', { id: t.id, mass: this.mass });
        this.giants.end(t.id);
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

  // Shed mass lets the orbit recover outward before gravity settles it again.
  releaseMass(amount: number): number {
    const o = this.rules.orbit,
      removed = Math.min(this.mass, amount);
    this.mass -= removed;
    this.orbitRecovery = Math.min(
      o.radius - this.radius,
      this.orbitRecovery + removed * o.gravityPerMass,
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

  // One hit on one particle, and everything its pop sets off: the kill effect, a meson's
  // split, XP and a level-up, a giant's fall and the rush.
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
    const { id, kind, particle, x, y } = target;
    if (target.veiled) {
      target.veiled = false;
      this.log('reveal', { id, x, y });
      return;
    }
    if (this.giants.phase(target)?.immune) return;
    damage *= this.giants.shield(target);
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp < 1e-8) target.hp = 0;
    if (kind === 'boss') this.giants.summon(target);
    this.log('hit', { id, kind, particle, damage, x, y, ...(crit && { crit }) });
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
        (target.final ? 54 : kind === 'boss' ? 36 : kind === 'dense' ? 11 : 6) *
        (style === 'burst' ? this.rules.combat.pops.burst.debris : 1),
      width: damage,
      life: 0.4 + delay,
      particle,
      ...(target.boss && { boss: target.boss }),
      delay,
    });
    // A meson splits into quarks as it pops.
    const split = this.rules.particles[particle].split;
    if (split && kind !== 'boss') this.spawner.spawnAround(target, 'quark', split, 3);
    const growth = this.growth,
      previous = growth.level;
    growth.gain(target.xp);
    if (kind === 'boss') this.giants.fall(target);
    this.spawner.killed(target.xp);
    this.log('kill', { id, kind, particle, xp: growth.xp, x, y, delay, style });
    if (growth.level === previous) return;
    this.log('level', { level: growth.level, xp: growth.xp });
    this.addEffect({
      kind: 'level',
      from: this.position,
      to: this.position,
      radius: 24,
      width: 1,
      life: 0.5,
    });
    growth.open();
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

  private collapse(trigger: Exclude<Trigger, 'quit'>): void {
    this.outcome = trigger === 'boss' ? 'success' : 'collapse-failure';
    this.trigger = trigger;
    this.collisionTime = this.time;
    this.phase = 'collapse';
    this.phaseTicks = 0;
    this.damageNumbers = [];
    this.growth.choice = null;
    this.log('collision', {
      trigger,
      outcome: this.outcome,
      xp: this.growth.xp,
      mass: this.mass,
    });
  }

  private finish(): void {
    const growth = this.growth;
    this.phase = 'result';
    this.result = {
      outcome: this.outcome,
      xp: growth.xp,
      level: growth.level,
      mass: this.mass,
      seed: this.seed,
      collisionTime: this.collisionTime,
      seconds: this.seconds,
      round: this.giants.round,
      trigger: this.trigger,
      ranks: { ...growth.ranks },
      boosts: { ...growth.boosts },
      rarities: { ...growth.rarities },
      evolved: { ...growth.evolved },
      pacts: { ...growth.pacts },
      selections: growth.selections.map((s) => ({ ...s })),
      endless: this.clearResult && {
        seconds: this.endlessSeconds,
        xp: growth.xp - this.clearResult.xp,
      },
    };
    this.log('result', { outcome: this.outcome });
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
    // Past the limit the oldest decoration goes first.
    if (this.effects.length > maxEffects) {
      const discard = this.effects.findIndex((fx) =>
        ['kill', 'absorb', 'charge', 'field'].includes(fx.kind),
      );
      this.effects.splice(Math.max(0, discard), 1);
    }
  }

  log<K extends EventKind>(kind: K, data: Events[K]): void {
    this.events.push({ time: this.time, kind, data } as Event);
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
