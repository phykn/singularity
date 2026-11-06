import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { rules } from '../src/game/rules.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import { GameSession } from '../src/app/GameSession.ts';
import {
  bestRecord,
  bestBeyondRecord,
  readBeyondRecord,
  beyondRecordKey,
  save,
} from '../src/app/storage.ts';
import { beyondFrame } from '../src/presentation/beyond.ts';
import { BLUE, VIOLET } from '../src/art/palette.ts';
import type { Result } from '../src/game/types.ts';
import { playRhythm } from '../scripts/rhythm-bot.ts';

// The first seed the reference bot clears, so balance changes do not break these tests.
let clearSeed: number | undefined;
function cleared(recordEvents = true) {
  for (let seed = clearSeed ?? 1500000; ; seed++) {
    const g = new Game(seed, { recordEvents });
    playRhythm(g, undefined, false);
    if (g.result?.outcome !== 'success') continue;
    clearSeed = seed;
    return g;
  }
}

test('only a normal clear can continue once, preserving the build and immutable clear result', () => {
  const g = cleared();
  const before = structuredClone(g.result!);
  assert.ok(g.canContinue);
  assert.ok(g.continueBeyond());
  assert.equal(g.phase, 'crossing');
  assert.equal(g.continueBeyond(), false);
  assert.deepEqual(g.clearResult, before);
  assert.deepEqual(g.ranks, before.ranks);
  assert.deepEqual(g.boosts, before.boosts);
  assert.deepEqual(g.rarities, before.rarities);
  assert.equal(g.xp, before.xp);
  assert.equal(g.mass, 0);
  assert.equal(g.radius, rules.orbitRadius);
  assert.equal(g.targets.length + g.effects.length + g.damageNumbers.length, 0);
  g.advance(rules.endless.entrySeconds * 1000);
  assert.equal(g.phase, 'running');
  assert.equal(g.endlessSeconds, 0);
  assert.equal(g.critical, false);
  g.advance(2900);
  assert.equal(g.targets.length, 0);
  assert.ok(g.warningWave);
  g.advance(100);
  assert.ok(g.targets.length > 0);
  assert.equal(g.wavePhase, 'assault');
  g.mass = 1000;
  g.radius = g.core + rules.electronRadius;
  g.advance(10000);
  assert.equal(g.result?.outcome, 'collapse-failure');
  assert.ok(g.result?.endless);
  assert.equal(g.result?.endless.xp, g.xp - before.xp);
  assert.deepEqual(g.clearResult, before);
  assert.equal(g.continueBeyond(), false);
  for (const c of Object.values(g.result!.counts))
    assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
  const failed = new Game(1703);
  failed.start();
  failed.advance(600000);
  assert.equal(failed.continueBeyond(), false);
});

// A cleared run that has crossed into endless play, with no choices left to open.
function beyond() {
  const g = cleared();
  g.continueBeyond();
  g.advance(rules.endless.entrySeconds * 1000 + 100);
  assert.equal(g.phase, 'running');
  g.selections.length = 1000;
  return g;
}
const tickOf = (g: Game) => g.advance(1000 / rules.tickRate);
// Plays the tick on which the current round's boss is due, keeping the core empty.
function reachRoundBoss(g: Game, from: number) {
  const base = Math.round(g.clearResult!.collisionTime * rules.tickRate);
  g.tick = base + Math.round((from + rules.endless.roundSeconds) * rules.tickRate) - 2;
  g.targets = [];
  g.mass = 0;
  g.choice = null;
  tickOf(g);
  assert.equal(g.boss, undefined, 'The boss waits for the end of the round');
  tickOf(g);
  assert.ok(g.boss, 'The round boss arrives');
  return g.boss;
}
function kill(g: Game, boss: NonNullable<Game['boss']>) {
  while (g.targets.includes(boss)) g.damageTarget(boss, boss.maxHp);
}

test('endless play starts in round seven and steps up when each round boss ends', () => {
  const g = beyond();
  assert.equal(g.round, 7);
  const entry = g.enemyStrength;
  const boss = reachRoundBoss(g, 0);
  assert.equal(boss.boss, rules.boss.stages[0].kind);
  assert.equal(boss.maxHp, Math.round(rules.boss.stages[0].hp * entry.hp));
  kill(g, boss);
  assert.equal(g.round, 8);
  assert.equal(g.enemyStrength.hp, entry.hp * rules.endless.roundHpMultiplier);
  assert.equal(
    g.enemyStrength.speed,
    entry.speed * Math.min(rules.endless.maxSpeedScale, 1 + rules.endless.roundSpeedStep),
  );
  // The next boss carries the stepped-up strength, reward and mass.
  const next = reachRoundBoss(g, g.endlessSeconds);
  const stage = rules.boss.stages[1];
  assert.equal(next.boss, stage.kind);
  assert.equal(next.maxHp, Math.round(stage.hp * g.enemyStrength.hp));
  assert.equal(next.xp, stage.xp * rules.endless.roundHpMultiplier);
  assert.equal(next.mass, stage.mass * rules.endless.roundHpMultiplier);
});

test('while an endless boss lives, difficulty holds and no other boss comes', () => {
  const g = beyond();
  reachRoundBoss(g, 0);
  const strength = g.enemyStrength,
    bosses = g.events.filter((e) => e.kind === 'boss').length;
  g.tick += rules.endless.roundSeconds * 3 * rules.tickRate;
  g.choice = null;
  tickOf(g);
  assert.deepEqual(g.enemyStrength, strength);
  assert.equal(g.events.filter((e) => e.kind === 'boss').length, bosses);
  assert.equal(g.round, 7);
});

test('endless bosses cycle through the five giant particles', () => {
  const g = beyond();
  const kinds = [];
  let from = 0;
  for (let i = 0; i < 6; i++) {
    const boss = reachRoundBoss(g, from);
    kinds.push(boss.boss);
    kill(g, boss);
    from = g.endlessSeconds;
  }
  const order = rules.boss.stages.map((stage) => stage.kind);
  assert.deepEqual(kinds, [...order, order[0]]);
  assert.equal(g.round, 13);
});

test('endless crowding, speed and late strength stay bounded', () => {
  const g = beyond();
  const entry = g.enemyStrength;
  g.spawnBatch();
  const old = structuredClone(g.targets);
  g.tick += rules.tickRate * 30;
  g.spawnBatch();
  assert.deepEqual(g.targets.slice(0, old.length), old);
  for (let i = 0; i < 100; i++) g.spawnBatch();
  assert.equal(g.targets.length, rules.endless.maxTargets);
  assert.equal(g.metrics.maxTargets, rules.endless.maxTargets);
  g.round += 1000;
  g.targets = [];
  g.spawnBatch();
  assert.ok(g.targets.every((t) => Number.isFinite(t.hp) && t.hp > 0 && Number.isFinite(t.speed)));
  assert.ok(g.enemyStrength.speed <= entry.speed * rules.endless.maxSpeedScale);
});

test('the entry clock ignores combat speed and freezes on pause or hidden tabs', () => {
  for (const speed of [1, 1.5, 2] as const) {
    const g = cleared();
    const audio = {
      enabled: false,
      update() {},
      async unlock() {
        return true;
      },
      suspend() {},
      destroy() {},
    };
    const session = new GameSession(g, audio, {
      sound: () => false,
      recordResult() {},
      audioUnlocked() {},
      redraw() {},
    });
    session.setRenderReady(true, 0);
    session.playbackSpeed = speed;
    session.continueBeyond(0);
    for (let wall = 100; wall <= 1000; wall += 100) session.step(wall);
    assert.equal(g.phaseTicks, 60);
    const frame = beyondFrame(g);
    session.pause(true, 1000);
    session.step(5000);
    assert.deepEqual(beyondFrame(g), frame);
    session.pause(false, 5000);
    session.setHidden(true, 5000);
    session.step(9000);
    assert.deepEqual(beyondFrame(g), frame);
    session.setHidden(false, 9000);
    for (let wall = 9100; wall <= 10400; wall += 100) session.step(wall);
    assert.equal(g.phase, 'running');
    assert.equal(g.endlessSeconds, 0);
    assert.equal(session.playbackSpeed, speed);
    assert.equal(session.pauseOnChoice, true);
  }
});

test('current checkpoints replay entry, manual endless choices and voluntary retirement', () => {
  const g = cleared();
  g.continueBeyond();
  g.advance(1200);
  const restored = restoreCheckpoint(createCheckpoint(g)!)!;
  assert.ok(restored);
  assert.deepEqual(beyondFrame(restored), beyondFrame(g));
  for (const run of [g, restored]) {
    run.advance(1250);
    for (let i = 0; i < 60 * 60 && run.phase === 'running' && !run.choice; i++)
      run.advance(1000 / 60);
    assert.ok(run.choice);
    assert.ok(run.select(run.choice.cards[1].id));
    run.advance(1000);
  }
  assert.deepEqual(g.events, restored.events);
  const late = restoreCheckpoint(createCheckpoint(g)!)!;
  assert.ok(late);
  assert.deepEqual(late.targets, g.targets);
  g.setManualPause(true);
  assert.ok(g.retire());
  assert.equal(g.result?.outcome, 'retired');
  assert.deepEqual(restoreCheckpoint(createCheckpoint(g)!)?.result, g.result);
});

test('clear and retired results emit once across continuation and replacement with separate records', () => {
  const g = cleared(),
    clear = g.result!;
  const saved: Result[] = [];
  const audio = {
    enabled: false,
    update() {},
    async unlock() {
      return true;
    },
    suspend() {},
    destroy() {},
  };
  const session = new GameSession(g, audio, {
    sound: () => false,
    redraw() {},
    audioUnlocked() {},
    recordResult(result) {
      saved.push(result);
    },
  });
  session.setRenderReady(true, 0);
  session.continueBeyond(0);
  session.advance(10000, 10);
  session.replace(new Game(21), 20);
  session.step(1020);
  session.step(2020);
  assert.equal(saved.length, 2);
  assert.equal(saved[0], clear);
  assert.equal(saved[1].outcome, 'retired');
  const normal = bestRecord(null, clear);
  assert.deepEqual(bestRecord(normal, saved[1]), normal);
  const record = bestBeyondRecord(null, saved[1])!;
  assert.ok(record.seconds > 0);
  assert.deepEqual(bestBeyondRecord(record, clear), record);
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
  } as Storage;
  save(storage, beyondRecordKey, record);
  assert.deepEqual(readBeyondRecord(storage), record);
  map.set(beyondRecordKey, '{"seconds":-1,"xp":0,"seed":1}');
  assert.equal(readBeyondRecord(storage), null);
});

test('entry key poses settle on the real electron position without screen flashes', () => {
  const g = cleared();
  g.continueBeyond();
  assert.equal(beyondFrame(g)?.stage, 'depart');
  assert.equal(beyondFrame(g)?.departure, 0);
  g.advance(200);
  assert.equal(beyondFrame(g)?.stage, 'contract');
  assert.equal(beyondFrame(g)?.departure, 1);
  assert.equal(beyondFrame(g)?.core, 24);
  assert.equal(beyondFrame(g)?.color, BLUE);
  g.advance(600);
  assert.equal(beyondFrame(g)?.stage, 'quiet');
  assert.equal(beyondFrame(g)?.point, 1);
  g.advance(200);
  assert.equal(beyondFrame(g)?.stage, 'open');
  g.advance(1350);
  const frame = beyondFrame(g)!;
  assert.equal(frame.stage, 'orbit');
  assert.ok(Math.abs(frame.ring - g.radius) < 0.1);
  assert.ok(Math.abs(frame.angle - g.angle) < 0.01);
  assert.equal(frame.color, VIOLET);
  assert.equal(frame.point, 0);
  assert.equal(beyondFrame(g, true)?.ring, g.radius);
  assert.equal(beyondFrame(g, true)?.angle, g.angle);
  g.phaseTicks = g.rules.tickRate * g.rules.endless.entrySeconds;
  assert.ok(Math.abs(beyondFrame(g)!.opacity - 0.32) < 1e-8);
  assert.equal(beyondFrame(g)!.ring, g.radius);
  assert.equal(beyondFrame(g)!.angle, g.angle);
});

test('the singularity contracts completely to a point before the orbit grows from its center', () => {
  const g = cleared();
  g.continueBeyond();
  let core = 24;
  for (let tick = 0; tick <= g.rules.tickRate * 0.9; tick++) {
    g.phaseTicks = tick;
    const frame = beyondFrame(g)!;
    assert.ok(frame.core >= 0 && frame.core <= core);
    assert.equal(frame.ring, 0, 'No replacement ring during contraction');
    if (tick >= g.rules.tickRate * 0.75) {
      assert.equal(frame.core, 0);
      assert.equal(frame.point, 1);
    }
    core = frame.core;
  }
  for (let tick = g.rules.tickRate * 0.9 + 1; tick < g.rules.tickRate * 2.4; tick++) {
    g.phaseTicks = tick;
    const frame = beyondFrame(g)!;
    assert.equal(frame.core, 0, 'The collapsed singularity cannot reappear');
    assert.ok(frame.ring > 0);
    assert.ok(frame.point >= 0 && frame.point <= 1);
  }
  assert.equal(beyondFrame(g, true)!.core, 0);
});

test('the result clears before contraction, and trail and dust join the opening smoothly', () => {
  const g = cleared(false);
  g.continueBeyond();
  let trail = 0;
  for (let tick = 0; tick <= g.rules.tickRate * g.rules.endless.entrySeconds; tick++) {
    g.phaseTicks = tick;
    const before = JSON.stringify(g, (key, value) => (key === 'combat' ? undefined : value));
    const frame = beyondFrame(g)!;
    assert.equal(
      JSON.stringify(g, (key, value) => (key === 'combat' ? undefined : value)),
      before,
    );
    if (frame.departure < 1) {
      assert.equal(frame.stage, 'depart');
      assert.equal(frame.core, 24, 'The singularity holds while the result clears');
      assert.equal(frame.point, 0);
    }
    if (frame.core < 24) assert.equal(frame.departure, 1);
    assert.ok(frame.trail >= trail && frame.trail <= 1);
    assert.ok(frame.trail - trail < 0.04, 'The trail cannot pop in');
    trail = frame.trail;
    assert.ok(frame.dust >= 0 && frame.dust <= 0.35);
    if (frame.expand === 0 || frame.expand === 1) assert.equal(frame.dust, 0);
  }
  assert.equal(trail, 1);
});

test('entry hue and brightness change continuously and settle at the combat appearance', () => {
  const g = cleared();
  g.continueBeyond();
  let previous = beyondFrame(g)!;
  for (let tick = 1; tick <= g.rules.tickRate * g.rules.endless.entrySeconds; tick++) {
    g.phaseTicks = tick;
    const frame = beyondFrame(g)!;
    for (const shift of [16, 8, 0])
      assert.ok(Math.abs(((frame.color >> shift) & 255) - ((previous.color >> shift) & 255)) <= 3);
    assert.ok(frame.opacity <= previous.opacity + 1e-8);
    assert.ok(previous.opacity - frame.opacity < 0.01);
    assert.ok(frame.ring >= previous.ring);
    previous = frame;
  }
  assert.equal(previous.color, VIOLET);
  assert.ok(Math.abs(previous.opacity - 0.32) < 1e-8);
});

test('checkpoints preserve automatic selection timing at 2x and the remaining choice timer', () => {
  const g = cleared();
  const audio = {
    enabled: false,
    update() {},
    async unlock() {
      return true;
    },
    suspend() {},
    destroy() {},
  };
  const session = new GameSession(g, audio, {
    sound: () => false,
    recordResult() {},
    audioUnlocked() {},
    redraw() {},
  });
  session.setRenderReady(true, 0);
  session.continueBeyond(0);
  session.playbackSpeed = 2;
  session.pauseOnChoice = false;
  for (
    let frame = 1;
    frame <= 60 * 90 && g.selections.length === g.clearResult!.selections.length;
    frame++
  )
    session.step((frame * 1000) / 60);
  assert.ok(g.selections.some((s) => s.time > g.clearResult!.collisionTime));
  const restored = restoreCheckpoint(createCheckpoint(g)!)!;
  assert.ok(restored);
  assert.deepEqual(restored.selections, g.selections);
  assert.deepEqual(restored.targets, g.targets);
  assert.deepEqual(restored.choice, g.choice);
});

test('continued combat produces the same outcome at 30 and 60 frames per second', () => {
  const runs = [30, 60].map((fps) => {
    const g = cleared();
    g.continueBeyond();
    for (let frame = 0; !g.result && frame < fps * 900; frame++) g.advance(1000 / fps);
    assert.ok(g.result?.endless);
    return g;
  });
  assert.deepEqual(runs[0].result, runs[1].result);
  assert.deepEqual(runs[0].events, runs[1].events);
});
