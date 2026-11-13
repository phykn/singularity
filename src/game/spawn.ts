import { formationSlots, formationsAt, interleave } from './formations.ts';
import type { FormationId, Shape } from './formations.ts';
import type { Game } from './Game.ts';
import { CENTER, TAU, clamp, goldenAngle, orbit } from './geometry.ts';
import { familyBase, particleKind } from './particles.ts';
import type { Family, Mix } from './particles.ts';
import type { Random } from './random.ts';
import type { ParticleKind, Rules } from './rules.ts';
import type { Target } from './types.ts';

type Stage = Rules['stages'][number];
type Member = Omit<Target, 'id' | 'x' | 'y' | 'born' | 'maxHp'>;
// A formation or a tether moves together.
type Shared = { speed: number; turn: number };
// A formation shown as faint dots until `time`; wave formations wait for their wave.
type Pending = { planned: number; time: number; members: Member[]; wave?: number };
type Wave = { time: number; angle: number; scale: number };

// Regular arrivals: batches on a timer, waves from two sides, formations and the rush
// that fast kills set off. Giants come by their own clock.
export class Spawner {
  readonly random: Random;
  pending: Pending[] = [];
  waves: Wave[];
  waveCount = 0;
  rushSpawns = 0;
  private readonly game: Game;
  private nextBatch = 0;
  private plannedWave = -1;
  private batches = 0;
  private kills: { tick: number; energy: number }[] = [];
  private killEnergy = 0;
  private rushUntil = 0;

  constructor(game: Game, random: Random, angles: Random) {
    this.game = game;
    this.random = random;
    const late = game.rules.late;
    this.waves = game.rules.stages
      .filter((s) => s.wave > 0)
      .map((s) => ({ time: s.start, angle: angles.next() * TAU, scale: s.wave }));
    // Repeats follow the listed waves every `late.waveRepeatSeconds`.
    const last = this.waves.at(-1);
    for (let i = 1; last && i <= 60; i++)
      this.waves.push({
        time: last.time + i * late.waveRepeatSeconds,
        angle: (last.angle + i * goldenAngle) % TAU,
        scale: late.waveScale,
      });
  }

  get stage(): number {
    return this.stageAt(this.game.time);
  }
  // After the last stage starts, each wave cycle opens with an assault, then a lull.
  get wavePhase(): 'steady' | 'assault' | 'recovery' {
    const g = this.game,
      cfg = g.rules,
      cycle = g.endless
        ? {
            repeat: cfg.endless.cycleSeconds,
            assault: cfg.endless.assaultSeconds,
            recovery: cfg.endless.recoverySeconds,
          }
        : {
            repeat: cfg.late.waveRepeatSeconds,
            assault: cfg.late.assaultSeconds,
            recovery: cfg.late.recoverySeconds,
          },
      age = g.endless
        ? g.endlessSeconds - cfg.spawn.waveWarningSeconds
        : g.time - cfg.stages.at(-1)!.start;
    if (age < 0) return 'steady';
    const at = age % cycle.repeat;
    if (at < cycle.assault) return 'assault';
    return at < cycle.assault + cycle.recovery ? 'recovery' : 'steady';
  }
  get rushing(): boolean {
    const g = this.game;
    return (
      g.phase === 'running' &&
      this.wavePhase !== 'recovery' &&
      g.tick < this.rushUntil &&
      g.targets.length < this.staged((s) => s.rush.maxTargets)
    );
  }
  // The next wave once its warning shows.
  get warningWave(): Wave | null {
    const g = this.game,
      wave = this.waves[this.waveCount];
    return g.phase === 'running' &&
      g.combatEnabled &&
      wave &&
      wave.time - g.time <= g.rules.spawn.waveWarningSeconds
      ? wave
      : null;
  }

  start(): void {
    this.spawnBatch();
    this.nextBatch = this.staged((s) => s.spawnSeconds) * this.game.rules.time.tickRate;
  }

  // Endless mode: an empty field and a wave every `cycleSeconds`, the first after one warning.
  beyond(): void {
    const g = this.game,
      warning = g.rules.spawn.waveWarningSeconds,
      last = this.waves.at(-1)!;
    this.pending = [];
    this.kills = [];
    this.killEnergy = this.rushUntil = this.rushSpawns = 0;
    this.waves = Array.from({ length: 600 }, (_, i) => ({
      time: g.time + warning + i * g.rules.endless.cycleSeconds,
      angle: (last.angle + (i + 1) * goldenAngle) % TAU,
      scale: g.rules.late.waveScale,
    }));
    this.waveCount = 0;
    this.plannedWave = -1;
    this.nextBatch = g.tick + warning * g.rules.time.tickRate;
  }

  update(): void {
    const g = this.game,
      cfg = g.rules;
    if (g.tick + 1e-8 >= this.nextBatch) {
      const rushing = this.rushing;
      this.spawnBatch();
      if (rushing) g.log('rush', { count: ++this.rushSpawns });
      this.nextBatch +=
        this.staged((s) => (rushing ? s.rush.spawnSeconds : s.spawnSeconds)) *
        cfg.time.tickRate *
        (this.wavePhase === 'recovery' ? cfg.late.recoverySpawnScale : 1) *
        (g.critical ? cfg.critical.spawnScale : 1) *
        (g.growth.pacts.greed ? 1 / (1 + cfg.pacts.greed.spawn) : 1) *
        (1 + this.random.spread() * cfg.spawn.variation.intervalFraction);
    }
    const wave = this.waves[this.waveCount];
    if (
      wave &&
      this.plannedWave !== this.waveCount &&
      g.time + 1e-8 >= wave.time - cfg.formations.previewSeconds
    ) {
      this.plannedWave = this.waveCount;
      this.planWave(wave);
    }
    if (wave && g.time >= wave.time) {
      const index = this.pending.findIndex((p) => p.wave === this.waveCount);
      if (index !== -1) this.place(this.pending.splice(index, 1)[0].members);
      g.log('wave', { number: ++this.waveCount, angle: wave.angle });
    }
    const ready = this.pending.filter((p) => p.wave === undefined && g.time + 1e-8 >= p.time);
    if (!ready.length) return;
    this.pending = this.pending.filter((p) => !ready.includes(p));
    for (const p of ready) this.place(p.members);
  }

  // Stage values climb geometrically toward the next stage's, so a stage start is no wall.
  staged(pick: (stage: Stage) => number, stage = this.stage): number {
    const stages = this.game.rules.stages,
      next = stages[stage + 1];
    if (!next) return pick(stages[stage]);
    const progress = clamp(
      (this.game.time - stages[stage].start) / (next.start - stages[stage].start),
    );
    return pick(stages[stage]) * (pick(next) / pick(stages[stage])) ** progress;
  }

  // Kills that come fast enough start a rush: batches arrive quicker for a while.
  killed(energy: number): void {
    const g = this.game,
      rush = g.rules.spawn.rush,
      window = rush.windowSeconds * g.rules.time.tickRate;
    this.kills.push({ tick: g.tick, energy });
    this.killEnergy += energy;
    let expired = 0;
    while (expired < this.kills.length && g.tick - this.kills[expired].tick >= window)
      this.killEnergy -= this.kills[expired++].energy;
    if (expired) this.kills.splice(0, expired);
    if (this.killEnergy < rush.energyThreshold) return;
    this.rushUntil = g.tick + window;
    if (this.rushing)
      this.nextBatch = Math.min(
        this.nextBatch,
        g.tick + this.staged((s) => s.rush.spawnSeconds) * g.rules.time.tickRate,
      );
  }

  // Members ringed around a particle; tethered ones travel with it.
  spawnAround(
    center: Target,
    particle: ParticleKind,
    count: number,
    spread: number,
    tether?: Target,
  ): void {
    const family = this.game.rules.particles[particle].family;
    this.place(
      Array.from({ length: count }, (_, i) => {
        const a = (i * TAU) / count + center.id,
          x = center.x - CENTER.x + spread * Math.cos(a),
          y = center.y - CENTER.y + spread * Math.sin(a);
        return {
          ...this.member(family, Math.atan2(y, x), Math.hypot(x, y), Math.sign(center.turn) || 1, {
            particle,
            shared: tether && { speed: tether.speed, turn: tether.turn },
          }),
          ...(tether && { tether: tether.id }),
        };
      }),
    );
  }

  // Small particles come in tight packs along the arc; dense ones at even gaps.
  spawnGroup(
    family: Family,
    count: number,
    angle: number,
    direction: number,
    origin = this.game.rules.orbit.spawnRadius,
  ): void {
    const r = this.random,
      cfg = this.game.rules.spawn,
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

  private stageAt(time: number): number {
    return this.game.rules.stages.filter((s) => time >= s.start).length - 1;
  }

  // Shares blend linearly from the previous stage's over the first `spawn.ramp` of a stage.
  private ramped(pick: (stage: Stage) => number): number {
    const stage = this.stage,
      stages = this.game.rules.stages;
    if (!stage) return pick(stages[0]);
    const start = stages[stage].start,
      length = (stages[stage + 1]?.start ?? 2 * start - stages[stage - 1].start) - start,
      blend = Math.min(1, clamp((this.game.time - start) / length) / this.game.rules.spawn.ramp);
    return pick(stages[stage - 1]) + (pick(stages[stage]) - pick(stages[stage - 1])) * blend;
  }

  private get mix(): Mix {
    const assault = this.wavePhase === 'assault',
      late = this.game.rules.late;
    return {
      muon: assault ? late.muonProbability : this.ramped((s) => s.shares.muon),
      neutrino: this.ramped((s) => s.shares.neutrino),
      meson: this.ramped((s) => s.shares.meson),
      neutron: assault ? late.neutronProbability : this.ramped((s) => s.shares.neutron),
    };
  }

  private spawnBatch(): void {
    const g = this.game,
      r = this.random,
      cfg = g.rules.spawn,
      v = cfg.variation,
      shapes = g.rules.formations;
    const roll = r.next(),
      angle = r.next() * TAU,
      direction = r.next() < 0.5 ? -1 : 1,
      intro = this.batches < cfg.introBatches;
    const smallChance =
      this.wavePhase === 'assault'
        ? g.rules.late.smallBatchProbability
        : this.ramped((s) => s.smallChance);
    const family: Family = intro || roll < smallChance ? 'small' : 'dense',
      size = family === 'small' ? cfg.smallBatchSize : cfg.denseBatchSize;
    const count = intro
      ? cfg.introBatchSize
      : Math.max(
          1,
          Math.round(size * this.staged((s) => s.batchScale) * (1 + r.spread() * v.batchFraction)),
        );
    // The first batches come in ahead of the electron.
    const center = intro
      ? g.angle + v.introAngleMin + r.next() * (v.introAngleMax - v.introAngleMin)
      : angle;
    this.batches++;
    const available = formationsAt(g.time, shapes);
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
    this.pending.push({ planned: g.time, time: g.time + shapes.previewSeconds, members });
    g.log('formation', { shape, count: members.length });
  }

  // Waves always come as formations from two sides, planned while their warning shows.
  private planWave(wave: Wave): void {
    const g = this.game,
      cfg = g.rules.spawn,
      small = Math.round((cfg.waveSmall / 2) * wave.scale),
      dense = Math.round((cfg.waveDense / 2) * wave.scale),
      stage = this.stageAt(wave.time),
      shapes = formationsAt(wave.time, g.rules.formations),
      shape = this.random.pick(shapes);
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
    this.pending.push({ planned: g.time, time: wave.time, members, wave: this.waveCount });
    g.log('formation', { shape, wave: this.waveCount + 1, count: members.length });
  }

  // A pincer sends two shapes, never rings, from opposite sides.
  private pincerSides(shapes: readonly FormationId[]): [Shape, Shape] {
    const sides = shapes.filter((id): id is Shape => id !== 'pincer' && id !== 'ring');
    return [this.random.pick(sides), this.random.pick(sides)];
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
    const g = this.game,
      cfg = g.rules.formations,
      hp = g.rules.stages[stage].hp;
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
    const slots = formationSlots(shape, kinds.length, angle, g.rules.orbit.spawnRadius, cfg),
      base = (family: Family) => g.rules.particles[familyBase[family]];
    const shared = {
      speed:
        Math.min(...kinds.map((k) => base(k).speed)) *
        g.enemyStrength.speed *
        (shape === 'clump' ? cfg.clump.speed : 1),
      turn: shape === 'line' || shape === 'star' ? 0 : base(kinds[0] ?? 'small').turn * direction,
    };
    return kinds.map((family, i) =>
      this.member(family, slots[i].theta, slots[i].radius, direction, { shared, stage }),
    );
  }

  // The species is drawn from the stage's mix unless given; species scale from their family.
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
    const g = this.game;
    particle ??= particleKind(family, this.random.next(), this.mix);
    const p = g.rules.particles[particle],
      base = g.rules.particles[familyBase[family]],
      strength = g.enemyStrength;
    const speed =
      shared?.speed ??
      base.speed *
        strength.speed *
        (1 + this.random.spread() * g.rules.spawn.variation.speedFraction);
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
    const g = this.game,
      placed = [];
    for (const member of members) {
      if (g.endless && g.targets.length >= g.rules.endless.maxTargets) break;
      const target: Target = {
        ...member,
        id: g.nextId++,
        ...orbit(member.angle, member.radius),
        born: g.time,
        maxHp: member.hp,
        ...(g.rules.particles[member.particle].veiled && { veiled: true }),
      };
      g.targets.push(target);
      placed.push({ id: target.id, particle: target.particle, angle: target.angle, hp: target.hp });
    }
    if (placed.length) g.log('spawn', { placed });
  }
}
