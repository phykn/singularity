import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { orbit } from '../src/game/geometry.ts';
import { particleIds } from '../src/game/particles.ts';
import type { Target } from '../src/game/types.ts';
import { rules } from '../src/game/rules.ts';
import { close, target, fixture, choose, run } from './helpers.ts';

test('limited catch-up retains every simulation tick and reaches the same state across frames', () => {
  const whole = new Game(1705);
  const chunked = new Game(1705);
  whole.start();
  chunked.start();
  whole.advance(1000);
  chunked.advance(1000, 8);
  assert.equal(chunked.elapsedTicks, 8);
  for (let frame = 0; frame < 7; frame++) chunked.advance(0, 8);
  assert.equal(chunked.elapsedTicks, 60);
  assert.deepEqual(chunked.events, whole.events);
  assert.deepEqual(chunked.targets, whole.targets);
  assert.deepEqual(chunked.effects, whole.effects);
  assert.deepEqual(chunked.damageNumbers, whole.damageNumbers);
  assert.deepEqual(createCheckpoint(chunked), createCheckpoint(whole));
  chunked.advance(0, 8);
  assert.equal(chunked.elapsedTicks, 60, 'Draining the backlog does not invent ticks');
});

test('automatic choices use the same deadline boundary inside and between advance calls', () => {
  const a = fixture(),
    b = fixture();
  for (const g of [a, b]) {
    g.choice = {
      number: 1,
      opened: 0,
      deadline: 1 + 1e-12,
      cards: [{ id: 'multi', rarity: 'common' }],
    };
    g.tick = rules.tickRate - 1;
  }
  a.advance(2000 / rules.tickRate);
  b.advance(1000 / rules.tickRate);
  b.advance(1000 / rules.tickRate);
  assert.equal(a.selections[0].time, 1);
  assert.deepEqual(a.selections, b.selections);
});

test('rush energy expires at its window boundary and remains correct through long kill histories', () => {
  const g = new Game(1705, {
    combat: false,
    rules: {
      ...rules,
      late: { ...rules.late, recoverySeconds: 0 },
      rush: { ...rules.rush, windowSeconds: 1, energyThreshold: 2 },
    },
  });
  g.start();
  const kill = (id: number) => {
    const enemy = target(id, 180, 128);
    g.targets = [enemy];
    g.counts.quark.generated++;
    g.damageTarget(enemy, 2);
  };
  for (let i = 0; i < 1100; i++) {
    g.tick += rules.tickRate;
    kill(i);
    assert.equal(g.rushing, false, 'An expired kill must not contribute energy');
  }
  kill(1100);
  assert.equal(g.rushing, true, 'Two current kills trigger a rush');
  g.tick += rules.tickRate;
  kill(1101);
  assert.equal(g.rushing, false);
  assert.equal(g.counts.quark.killed, 1102);
  assert.equal(g.xp, 1102);

  const disabled = new Game(1705, {
    combat: false,
    rules: { ...rules, rush: { ...rules.rush, windowSeconds: 0 } },
  });
  disabled.start();
  const enemy = target(0, 180, 128);
  disabled.targets = [enemy];
  disabled.damageTarget(enemy, 2);
  assert.equal(disabled.rushing, false);
});

test('custom rules control simulation ticks, the initial orbit and the first attack deadline', () => {
  const cfg = {
    ...rules,
    tickRate: 30,
    attackBaseSeconds: 2,
    orbitRadius: 120,
    baseSpeed: 0,
    spawnSecondsByStage: Array(5).fill(10000),
  };
  const game = new Game(42, { rules: cfg });
  game.start();
  const enemy = target(900, game.position.x, game.position.y, 100);
  game.targets = [enemy];
  assert.equal(game.radius, 120);
  assert.equal(game.metrics.minRadius, 120);
  game.advance(1999);
  assert.equal(game.tick, 59);
  assert.equal(enemy.hp, 100);
  game.advance(1);
  assert.equal(game.tick, 60);
  assert.equal(game.seconds, 2);
  assert.equal(game.time, 2);
  assert.equal(enemy.hp, 100 - cfg.baseHitDamage);
});

test('moving particles approach and death and absorption are mutually exclusive', () => {
  const p = target(0, 180, 90);
  p.speed = 7;
  p.turn = 0.12;
  const g = fixture({}, [p]);
  g.advance(1000);
  close(p.radius, 163);
  close(p.angle, -Math.PI / 2 + 0.12);
  assert.notEqual(p.x, 180);
  const killed = fixture({}, [target(0, 180, 275)]);
  killed.combat.fireBasic({ x: 180, y: 275 });
  killed.absorbTargets();
  assert.equal(killed.xp, 1);
  assert.equal(killed.mass, 0);
  assert.equal(killed.counts.quark.absorbed, 0);
  const absorbed = fixture({}, [target(0, 180, 278, 100, 'dense')]);
  absorbed.combat.fireBasic({ x: 180, y: 278 });
  absorbed.absorbTargets();
  absorbed.absorbTargets();
  assert.equal(absorbed.xp, 0);
  assert.equal(absorbed.mass, rules.targets.dense.mass);
  assert.equal(absorbed.counts.proton.absorbed, 1);
  assert.equal(absorbed.targets.length, 0);
});

test('results separate every particle species through death, absorption and survival', () => {
  const targets = particleIds.flatMap((particle, i) => {
    const kind = i < 2 ? 'small' : 'dense';
    return [
      target(i * 3, 30 + i * 100, 100, 1, kind),
      target(i * 3 + 1, 180, 260, 100, kind),
      target(i * 3 + 2, 30 + i * 100, 400, 100, kind),
    ].map((t) => ({ ...t, particle }));
  });
  const g = fixture({}, targets);
  for (const t of targets.filter((t) => t.hp === 1)) g.combat.fireBasic(t);
  g.absorbTargets();
  g.mass = 1000;
  g.radius = g.core + 4;
  g.advance(16000);
  assert.ok(g.result);
  assert.deepEqual(Object.keys(g.result.counts), particleIds);
  for (const id of particleIds)
    assert.deepEqual(g.result.counts[id], { generated: 3, killed: 1, absorbed: 1, remaining: 1 });
});

test('mass vent immediately removes mass and restores the orbit gradually at fixed movement speed', () => {
  const g = fixture();
  g.mass = 80;
  g.advance(30000);
  assert.equal(g.phase, 'running');
  assert.ok(g.radius < rules.orbitRadius);
  const before = g.radius,
    speed = g.speed;
  choose(g, 'recover');
  assert.equal(g.speed, speed);
  assert.equal(g.mass, 80 - rules.recovery.mass);
  assert.equal(g.radius, before);
  g.advance(1000);
  close(g.radius, before + rules.outwardSpeed);
  g.advance(10000);
  close(g.radius, before + rules.recovery.mass * rules.gravityPerMass);
  for (let i = 0; i < 36; i++) {
    const p = orbit((i * Math.PI) / 18, g.radius);
    close(Math.hypot(p.x - 180, p.y - 260), g.radius);
  }
});

test('mass release reverses an actively shrinking orbit even while gravity still targets a smaller radius', () => {
  const g = fixture();
  g.mass = 150;
  g.radius = 100;
  g.advance(1000);
  close(g.radius, 96);
  const before = g.radius;
  choose(g, 'recover');
  assert.equal(g.mass, 100);
  assert.ok(g.targetRadius < before, 'Gravity has not yet caught up with the actual orbit');
  assert.equal(g.radius, before, 'Recovery must not teleport the electron');
  g.advance(1000);
  close(g.radius, before + rules.outwardSpeed);
  g.advance((265 * 1000) / rules.tickRate);
  close(g.radius, before + rules.recovery.mass * rules.gravityPerMass);
  const recovered = g.radius;
  g.advance(1000 / rules.tickRate);
  close(g.radius, recovered - rules.inwardSpeed / rules.tickRate);
  assert.equal(g.mass, 100, 'The recovery impulse cannot remove extra mass');
});

test('repeated mass releases cap the orbit and retain recovery while paused or hidden', () => {
  const g = fixture();
  g.mass = 150;
  g.radius = 120;
  choose(g, 'recover');
  choose(g, 'recover');
  assert.equal(g.mass, 50);
  g.setManualPause(true);
  g.advance(10000);
  assert.equal(g.radius, 120);
  g.setManualPause(false);
  g.setHidden(true);
  g.advance(10000);
  assert.equal(g.radius, 120);
  g.setHidden(false);
  g.advance(2000);
  close(g.radius, rules.orbitRadius);
  g.advance(1000);
  close(g.radius, rules.orbitRadius - rules.inwardSpeed);
});

test('mass release recovery follows rarity, clamps removed mass and is independent of frame rate', () => {
  for (const rarity of ['common', 'rare', 'epic', 'legendary'] as const) {
    const runs = [30, 60].map((fps) => {
      const g = fixture();
      g.mass = 150;
      g.radius = 60;
      const xp = g.xp;
      choose(g, 'recover', rarity);
      const removed = 150 - g.mass;
      for (let frame = 0; frame < fps; frame++) g.advance(1000 / fps);
      close(g.radius, 60 + rules.outwardSpeed);
      const ticks = Math.ceil(
        (Math.min(rules.orbitRadius - 60, removed * rules.gravityPerMass) / rules.outwardSpeed) *
          rules.tickRate -
          1e-8,
      );
      g.advance(((ticks - rules.tickRate) * 1000) / rules.tickRate);
      close(g.radius, Math.min(rules.orbitRadius, 60 + removed * rules.gravityPerMass));
      assert.equal(g.xp, xp);
      return g;
    });
    close(runs[0].radius, runs[1].radius);
    assert.deepEqual(runs[0].events, runs[1].events);
  }
  const g = fixture();
  g.mass = rules.recovery.minMass;
  g.radius = 120;
  choose(g, 'recover', 'legendary');
  assert.equal(g.mass, 0);
  g.advance(10000);
  close(g.radius, rules.orbitRadius);
});

test('early collision snapshots the energy boundary and cancels combat and cards', () => {
  for (const xp of [rules.energyGoal - 1, rules.energyGoal]) {
    const g = fixture({ repel: 3, focus: 3 });
    g.debugSetXp(xp);
    g.mass = 1000;
    g.radius = g.core + rules.electronRadius + 0.01;
    g.advance(1000 / 60);
    assert.equal(g.phase, 'collapse');
    assert.equal(g.choice, null);
    assert.equal(g.successfulEnding, xp >= rules.energyGoal);
    const frozen = { xp: g.xp, mass: g.mass, time: g.time };
    g.debugSetXp(100000);
    assert.equal(g.xp, xp);
    g.setManualPause(true);
    g.advance(10000);
    assert.equal(g.phaseProgress, 0);
    g.setManualPause(false);
    g.advance(rules.collisionSeconds * 1000);
    assert.equal(g.phase, 'ending');
    g.advance(
      (g.successfulEnding ? rules.successEndingSeconds : rules.failureEndingSeconds) * 1000,
    );
    assert.ok(g.result);
    assert.deepEqual({ xp: g.xp, mass: g.mass, time: g.time }, frozen);
    assert.equal(g.result.trigger, xp >= rules.energyGoal ? 'energy' : 'gravity');
    assert.equal(g.result.outcome, xp >= rules.energyGoal ? 'success' : 'collapse-failure');
    assert.equal(
      g.events.some((e) => e.kind === 'hit' && e.time >= frozen.time),
      false,
    );
  }
});

test('elapsed time never ends a run and reaching the XP goal starts a successful collapse', () => {
  assert.equal(rules.energyGoal, 20000);
  const g = fixture();
  g.debugSetXp(rules.energyGoal - 1);
  g.advance(3600000);
  assert.equal(g.phase, 'running');
  assert.equal(g.seconds, 3600);
  assert.equal(g.stage, rules.stageStarts.length - 1);
  assert.equal(g.result, null);
  const enemy = target(0, 180, 128, 1);
  g.targets = [enemy];
  g.counts.quark.generated++;
  g.combat.fireBasic(enemy);
  assert.equal(g.xp, rules.energyGoal);
  const choices = g.selections.length;
  g.advance(1000 / rules.tickRate);
  assert.equal(g.phase, 'collapse');
  assert.equal(g.choice, null);
  assert.equal(g.successfulEnding, true);
  g.advance(15000);
  assert.equal(g.result?.trigger, 'energy');
  assert.equal(g.result?.missingXp, 0);
  assert.equal(g.selections.length, choices);
  close(
    g.result!.seconds,
    3600 + rules.collisionSeconds + rules.successEndingSeconds + 1 / rules.tickRate,
  );
});

test('late spawns keep their stage and scheduled waves continue beyond ten minutes', () => {
  const g = fixture();
  const next = rules.waves.at(-1)! + rules.waveRepeatSeconds * 2;
  g.tick = (next - 1) * rules.tickRate;
  g.elapsedTicks = g.tick;
  g.waveCount = rules.waves.length + 1;
  g.combatEnabled = true;
  const warning = g.warningWave!;
  assert.equal(warning.time, next);
  g.advance(1000);
  assert.equal(g.waveCount, rules.waves.length + 2);
  assert.equal(g.upcomingWave.time, next + rules.waveRepeatSeconds);
  assert.equal(g.stage, rules.stageStarts.length - 1);
  assert.ok(g.targets.length >= (rules.waveSmall + rules.waveDense) * rules.waveScale.at(-1)!);
  assert.ok(
    g.targets.every((t) => Number.isFinite(t.hp) && t.maxHp >= rules.targets.small.hp.at(-1)!),
  );
});

test('late assaults and recovery follow the warned waves and freeze with the game clock', () => {
  const g = fixture();
  const start = rules.stageStarts.at(-1)!;
  for (const offset of [0, rules.waveRepeatSeconds, rules.waveRepeatSeconds * 3]) {
    const time = start + offset;
    g.tick = (time - 1 / rules.tickRate) * rules.tickRate;
    assert.equal(g.wavePhase, 'steady');
    g.advance(1000 / rules.tickRate);
    assert.equal(g.wavePhase, 'assault');
    g.setManualPause(true);
    const tick = g.tick;
    g.advance(30000);
    assert.equal(g.tick, tick);
    assert.equal(g.wavePhase, 'assault');
    g.setManualPause(false);
    g.tick = (time + rules.late.assaultSeconds) * rules.tickRate;
    assert.equal(g.wavePhase, 'recovery');
    g.tick = (time + rules.late.assaultSeconds + rules.late.recoverySeconds) * rules.tickRate;
    assert.equal(g.wavePhase, 'steady');
  }
});

test('recovery stops kill-triggered rush even when the build clears a whole group', () => {
  const g = fixture({ multi: 5, chain: 5 });
  g.tick = (rules.stageStarts.at(-1)! + rules.late.assaultSeconds) * rules.tickRate;
  g.spawnBatch();
  while (g.targets.length) g.combat.fireBasic(g.targets[0]);
  assert.ok(g.xp >= rules.rush.energyThreshold);
  assert.equal(g.wavePhase, 'recovery');
  assert.equal(g.rushing, false);
});

test('late enemy strength grows at spawn with a speed cap and preserves existing enemies', () => {
  const start = rules.stageStarts.at(-1)!;
  const a = fixture(),
    b = fixture();
  a.tick = (start + 30) * rules.tickRate;
  b.tick = (start + 30 + rules.waveRepeatSeconds * 3) * rules.tickRate;
  a.spawnBatch();
  b.spawnBatch();
  assert.equal(a.targets.length, b.targets.length);
  for (const [i, target] of a.targets.entries()) {
    assert.equal(target.particle, b.targets[i].particle);
    assert.ok(b.targets[i].hp > target.hp);
    assert.ok(b.targets[i].speed > target.speed);
    const cap =
      rules.targets[target.kind].speed *
      (target.particle === 'neutron' ? 0.85 : 1) *
      rules.late.maxSpeedScale *
      (1 + rules.spawnVariation.speedFraction);
    assert.ok(b.targets[i].speed <= cap);
  }
  const existing = structuredClone(a.targets);
  a.tick = b.tick;
  a.spawnBatch();
  assert.deepEqual(a.targets.slice(0, existing.length), existing);
});

test('late assault composition increases durable and dashing enemies without increasing batch count', () => {
  const a = fixture(),
    b = fixture();
  a.tick = rules.stageStarts.at(-1)! * rules.tickRate;
  b.tick = (rules.stageStarts.at(-1)! + 30) * rules.tickRate;
  for (let i = 0; i < 60; i++) {
    a.spawnBatch();
    b.spawnBatch();
  }
  const share = (g: Game, particle: string, kind: string) =>
    g.targets.filter((t) => t.particle === particle).length /
    g.targets.filter((t) => t.kind === kind).length;
  assert.ok(a.targets.length < b.targets.length);
  assert.ok(share(a, 'muon', 'small') > share(b, 'muon', 'small'));
  assert.ok(share(a, 'neutron', 'dense') > share(b, 'neutron', 'dense'));
});

test('checkpoint replay preserves the late assault, spawned strength and recovery schedule', (t) => {
  const goal = rules.energyGoal,
    gravity = rules.gravityPerMass;
  t.after(() => {
    rules.energyGoal = goal;
    rules.gravityPerMass = gravity;
  });
  // Reach the late phase independently of whether this seed can win the current balance.
  rules.energyGoal = 100000;
  rules.gravityPerMass = 0;
  const g = new Game(107005);
  g.start();
  g.advance((rules.stageStarts.at(-1)! + 5) * 1000);
  assert.equal(g.phase, 'running');
  assert.equal(g.wavePhase, 'assault');
  const restored = restoreCheckpoint(createCheckpoint(g)!);
  assert.ok(restored);
  assert.deepEqual(restored.targets, g.targets);
  assert.equal(restored.wavePhase, g.wavePhase);
  g.advance(14000);
  restored.advance(14000);
  assert.deepEqual(restored.events, g.events);
  assert.deepEqual(restored.result, g.result);
});

test('contact at zero margin ends the run; a timely mass vent recovers a narrow orbit', () => {
  const unsafe = fixture();
  unsafe.mass = 1000;
  unsafe.radius = unsafe.core + 4;
  unsafe.advance(1000 / 60);
  assert.equal(unsafe.phase, 'collapse');
  const recover = fixture();
  recover.mass = (rules.orbitRadius - 40) / rules.gravityPerMass;
  recover.radius = 40;
  choose(recover, 'recover');
  recover.advance(2000);
  assert.equal(recover.phase, 'running');
  close(recover.radius, 52);
});

test('wave warnings precede the same spawn directions and stage changes do not alter existing HP', () => {
  const g = new Game(1701);
  g.start();
  g.advance(87000);
  assert.equal(g.warningWave?.time, 90);
  const angle = g.warningWave!.angle;
  g.advance(3000);
  assert.equal(g.waveCount, 1);
  assert.equal(g.warningWave, null);
  const wave = g.events.find((e) => e.kind === 'wave')!.data as { angle: number };
  assert.equal(wave.angle, angle);
  const expected = g.events
    .filter((e) => e.kind === 'spawn' && e.time === 90)
    .flatMap((e) => (e.data as { planned: Target[] }).planned);
  assert.equal(expected.length, rules.waveSmall + rules.waveDense);
  const h = fixture();
  h.tick = 89 * 60;
  h.spawnBatch();
  const hp = h.targets.map((t) => t.maxHp);
  h.advance(2000);
  assert.deepEqual(
    h.targets.map((t) => t.maxHp),
    hp,
  );
});

test('full games conserve particles and are identical at 30 and 60fps', () => {
  for (const seed of [1701, 1702, 1703]) {
    const a = run(seed, 30),
      b = run(seed, 60);
    assert.deepEqual(a.result, b.result);
    assert.deepEqual(a.events, b.events);
    for (const id of particleIds) {
      const c = a.result!.counts[id];
      assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
    }
    assert.equal(a.result!.trigger, a.result!.outcome === 'success' ? 'energy' : 'gravity');
  }
});

test('fast clear brings the next batch sooner, crowding stops rush, and score only rewards kills', () => {
  const fast = new Game(1);
  fast.ranks.pierce = 3;
  fast.ranks.chain = 3;
  fast.start();
  fast.spawnBatch();
  while (fast.targets.length) fast.combat.fireBasic(fast.targets[0]);
  assert.ok(fast.rushing);
  assert.ok(fast.xp >= rules.rush.energyThreshold);
  const generated = Object.values(fast.counts).reduce((sum, c) => sum + c.generated, 0);
  fast.advance(rules.rush.spawnSecondsByStage[0] * 1000);
  assert.ok(Object.values(fast.counts).reduce((sum, c) => sum + c.generated, 0) > generated);
  assert.ok(fast.rushSpawns > 0);
  assert.ok(fast.score > 0);
  const ordinary = new Game(1);
  ordinary.start();
  ordinary.spawnBatch();
  ordinary.advance(rules.rush.spawnSecondsByStage[0] * 1000);
  assert.equal(
    Object.values(ordinary.counts).reduce((sum, c) => sum + c.generated, 0),
    generated,
  );
  const crowded = fixture(
    { multi: 3 },
    Array.from({ length: 50 }, (_, id) => target(id, 181 + id, 128)),
  );
  crowded.combat.fireBasic();
  crowded.combat.fireBasic();
  assert.ok(crowded.xp > 0 && crowded.xp <= 8);
  assert.equal(crowded.targets.length, 50 - crowded.xp);
  assert.equal(crowded.rushing, false);
  const absorbed = fixture({}, [target(0, 180, 275)]);
  absorbed.absorbTargets();
  assert.equal(absorbed.score, 0);
  const early = fixture({}, [target(0, 180, 128)]),
    late = fixture({}, [target(0, 180, 278)]);
  early.combat.fireBasic(early.targets[0]);
  late.combat.fireBasic(late.targets[0]);
  assert.ok(early.score > late.score);
});

test('later stages increase group size, wave size and intake rate without changing existing enemy HP', () => {
  const first = new Game(42, { combat: false });
  first.start();
  const late = new Game(42, { combat: false });
  late.start();
  late.tick = 451 * rules.tickRate;
  for (let i = 0; i < 3; i++) {
    first.spawnBatch();
    late.spawnBatch();
  }
  first.targets = [];
  late.targets = [];
  for (let i = 0; i < 20; i++) {
    first.spawnBatch();
    late.spawnBatch();
  }
  assert.ok(late.targets.length > first.targets.length * 3);
  assert.ok(rules.spawnSecondsByStage[4] < rules.spawnSecondsByStage[0]);
  assert.ok(rules.rush.spawnSecondsByStage[4] < rules.rush.spawnSecondsByStage[0]);
  const existing = first.targets[0],
    hp = existing.hp;
  first.tick = late.tick;
  first.spawnBatch();
  assert.equal(existing.hp, hp);
  assert.ok(late.targets.some((t) => t.kind === 'small'));
  assert.ok(late.targets.some((t) => t.kind === 'dense'));
});

test('particle species enter gradually and heavy neutrons trade speed for health and mass', () => {
  for (let stage = 0; stage < 3; stage++) {
    const g = fixture();
    g.tick = (stage ? rules.stageStarts[stage] : 0) * rules.tickRate;
    for (let i = 0; i < 80; i++) g.spawnBatch();
    const species = [...new Set(g.targets.map((t) => t.particle))].sort();
    assert.deepEqual(
      species,
      (stage === 0
        ? ['quark', 'proton']
        : stage === 1
          ? ['quark', 'proton', 'muon']
          : ['quark', 'proton', 'muon', 'neutron']
      ).sort(),
    );
    for (const t of g.targets) assert.equal(t.born, g.time);
    if (stage === 2) {
      const neutron = g.targets.find((t) => t.particle === 'neutron')!;
      const proton = g.targets.find((t) => t.particle === 'proton')!;
      assert.ok(
        neutron.hp > proton.hp && neutron.mass > proton.mass && neutron.speed < proton.speed,
      );
      g.targets = [neutron];
      neutron.radius = g.core;
      g.absorbTargets();
      assert.equal(g.mass, neutron.mass);
      assert.equal(g.xp, 0);
    }
  }
});

test('seeded spawns vary formation, radius, speed and batch size within designer bounds', () => {
  const a = new Game(894, { combat: false }),
    b = new Game(894, { combat: false });
  a.start();
  b.start();
  const sizes: number[] = [];
  for (let i = 0; i < 40; i++) {
    const before = a.targets.length;
    a.spawnBatch();
    b.spawnBatch();
    sizes.push(a.targets.length - before);
  }
  assert.deepEqual(a.targets, b.targets);
  assert.ok(new Set(a.targets.map((t) => t.radius)).size > 20);
  assert.ok(new Set(a.targets.map((t) => t.speed)).size > 20);
  for (const t of a.targets) {
    assert.ok(
      t.radius >= rules.spawnRadius &&
        t.radius <= rules.spawnRadius + rules.spawnVariation.radiusSpread,
    );
    const base = rules.targets[t.kind].speed;
    assert.ok(
      t.speed >= base * (1 - rules.spawnVariation.speedFraction) &&
        t.speed <= base * (1 + rules.spawnVariation.speedFraction),
    );
  }
  assert.ok(new Set(sizes.slice(rules.introBatches)).size >= 3);
  const other = new Game(895, { combat: false });
  other.start();
  other.spawnBatch();
  assert.notDeepEqual(a.targets.slice(0, rules.introBatchSize), other.targets);
});

test('muons pause before a straight dash and recover the average inward pace over a full cycle', () => {
  const t = target(0, 180, 90, 100);
  t.particle = 'muon';
  t.speed = 10;
  t.turn = 0.12;
  const g = fixture({}, [t]),
    initial = { radius: t.radius, angle: t.angle };
  g.advance(300);
  close(t.radius, initial.radius);
  close(t.angle, initial.angle);
  g.advance(250);
  assert.ok(t.radius < initial.radius - 4);
  close(t.angle, initial.angle);
  g.advance(1850);
  close(t.radius, initial.radius - 24);
  close(t.angle, initial.angle + 0.12 * 2.4);
});
