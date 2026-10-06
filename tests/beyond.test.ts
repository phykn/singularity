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
import { beyondFrame } from '../src/render/beyond.ts';
import type { Result } from '../src/game/types.ts';

function cleared() {
  const g = new Game(1701);
  g.start();
  g.advance(600000);
  assert.equal(g.result?.outcome, 'success');
  return g;
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
  assert.equal(g.charged, false);
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

test('new endless enemies strengthen quickly while speed and crowding stay bounded', () => {
  const g = cleared();
  g.continueBeyond();
  g.advance(2400);
  const entry = g.enemyStrength;
  g.tick += rules.tickRate * 60;
  assert.equal(g.enemyStrength.hp, entry.hp * 2.25);
  g.spawnBatch();
  const old = structuredClone(g.targets);
  g.tick += rules.tickRate * 30;
  g.spawnBatch();
  assert.deepEqual(g.targets.slice(0, old.length), old);
  for (let i = 0; i < 100; i++) g.spawnBatch();
  assert.equal(g.targets.length, rules.endless.maxTargets);
  assert.equal(g.metrics.maxTargets, rules.endless.maxTargets);
  assert.ok(g.enemyStrength.speed <= entry.speed * rules.endless.maxSpeedScale);
  g.tick += 1e12;
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
      saveResult: () => true,
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
    run.advance(30000);
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

test('clear saves retry during and after continuation and beyond records never replace normal clears', () => {
  const g = cleared(),
    clear = g.result!;
  let writable = false;
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
    saveResult(result) {
      if (!writable) return false;
      saved.push(result);
      return true;
    },
  });
  session.setRenderReady(true, 0);
  session.continueBeyond(0);
  session.advance(10000, 10);
  session.replace(new Game(21), 20);
  writable = true;
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
  assert.equal(beyondFrame(g)?.stage, 'contract');
  g.advance(800);
  assert.equal(beyondFrame(g)?.stage, 'quiet');
  g.advance(200);
  assert.equal(beyondFrame(g)?.stage, 'open');
  g.advance(1350);
  const frame = beyondFrame(g)!;
  assert.equal(frame.stage, 'orbit');
  assert.ok(Math.abs(frame.ring - g.radius) < 0.1);
  assert.ok(Math.abs(frame.angle - g.angle) < 0.01);
  assert.equal(beyondFrame(g, true)?.ring, g.radius);
  assert.equal(beyondFrame(g, true)?.angle, g.angle);
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
    saveResult: () => true,
    redraw() {},
  });
  session.setRenderReady(true, 0);
  session.continueBeyond(0);
  session.playbackSpeed = 2;
  session.pauseOnChoice = false;
  for (let frame = 1; frame <= 60 * 20; frame++) session.step((frame * 1000) / 60);
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
