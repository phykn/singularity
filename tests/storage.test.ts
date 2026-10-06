import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { rules, skillIds } from '../src/game/rules.ts';
import {
  bestRecord,
  readLanguage,
  readRecord,
  readSettings,
  languageKey,
  recordKey,
  save,
  settingsKey,
} from '../src/app/storage.ts';
import { fixture, run } from './helpers.ts';

test('best records preserve settings and handle malformed or unavailable storage', () => {
  const g = fixture();
  g.debugSetXp(rules.energyGoal);
  g.advance(610000);
  const success = bestRecord(null, g.result!);
  assert.ok(success);
  const fail = { ...g.result!, outcome: 'collapse-failure' as const, xp: rules.energyGoal - 1 };
  assert.equal(bestRecord(success, fail), success);
  const improved = bestRecord(success, { ...g.result!, xp: rules.energyGoal + 1 });
  assert.ok(improved);
  assert.equal(improved.xp, rules.energyGoal + 1);
  const failedRecord = bestRecord(null, fail);
  assert.ok(failedRecord);
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  } as Storage;
  map.set(settingsKey, JSON.stringify({ sound: true }));
  assert.equal(readRecord(storage), null);
  assert.deepEqual(readSettings(storage), { sound: true });
  assert.ok(save(storage, recordKey, success));
  assert.deepEqual(readRecord(storage), success);
  map.set(recordKey, JSON.stringify({ ...success, xp: -1 }));
  assert.equal(readRecord(storage), null);
  map.set(recordKey, '{');
  assert.equal(readRecord(storage), null);
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  } as unknown as Storage;
  assert.equal(save(blocked, recordKey, success), false);
  assert.equal(readRecord(blocked), null);
  assert.deepEqual(readSettings(blocked), { sound: false });
});

test('language preferences persist, invalid or unavailable storage falls back to Korean', () => {
  let saved: string | null = null;
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  } as Storage;
  assert.equal(readLanguage(storage), 'ko');
  for (const language of ['ko', 'en', 'zh', 'ja'] as const) {
    assert.ok(save(storage, languageKey, language));
    assert.equal(readLanguage(storage), language);
  }
  saved = '"fr"';
  assert.equal(readLanguage(storage), 'ko');
  saved = '{';
  assert.equal(readLanguage(storage), 'ko');
  assert.equal(
    readLanguage({
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage),
    'ko',
  );
});

test('saved runs restore pending cards, moving enemies and reserved attacks with the same future', () => {
  for (const seed of [10000, 10004, 10017]) {
    const g = new Game(seed);
    g.start();
    for (let i = 0; i < 60 * 75 && g.phase === 'running'; i++) {
      g.advance(1000 / 60);
      if (g.choice && g.selections.length < 2) g.select(g.choice.cards[1].id);
    }
    const checkpoint = createCheckpoint(g)!;
    const restored = restoreCheckpoint(JSON.parse(JSON.stringify(checkpoint)))!;
    assert.ok(restored);
    for (const key of [
      'phase',
      'tick',
      'elapsedTicks',
      'xp',
      'mass',
      'radius',
      'angle',
      'ranks',
      'boosts',
      'rarities',
      'targets',
      'effects',
      'damageNumbers',
      'choice',
      'selections',
      'events',
    ] as const)
      assert.deepEqual(restored[key], g[key], seed + ': ' + key);
    for (const id of skillIds)
      assert.deepEqual(restored.combat.status(id), g.combat.status(id), seed + ': cooldown ' + id);
    restored.advance(610000);
    g.advance(610000);
    assert.deepEqual(restored.result, g.result);
    assert.deepEqual(restored.events, g.events);
  }
});

test('checkpoints preserve manual pause but omit background pause; ready games have no checkpoint', () => {
  const g = new Game(10004);
  g.start();
  for (let i = 0; i < 1800 && !g.choice; i++) g.advance(1000 / 60);
  assert.ok(g.choice);
  g.setManualPause(true);
  g.setHidden(true);
  const checkpoint = JSON.stringify(createCheckpoint(g));
  assert.ok(checkpoint.length < 2000);
  const restored = restoreCheckpoint(JSON.parse(checkpoint))!;
  assert.ok(restored.manualPaused);
  assert.equal(restored.hiddenPaused, false);
  assert.deepEqual(restored.choice, g.choice);
  assert.equal(restored.time, g.time);
  restored.advance(10000);
  assert.equal(restored.time, g.time);
  restored.setManualPause(false);
  g.setManualPause(false);
  g.setHidden(false);
  restored.advance(610000);
  g.advance(610000);
  assert.deepEqual(restored.result, g.result);
  assert.deepEqual(restoreCheckpoint(createCheckpoint(restored)!)?.result, restored.result);
  assert.equal(createCheckpoint(new Game(g.seed)), null);
});

test('checkpoints and records accept a run past ten minutes and a manual choice beyond number 25', (t) => {
  // Isolate long-save behavior from the current difficulty: extend the goal and
  // remove gravity so this fixture can reach choice 26 and ten minutes even as
  // late enemies continue to strengthen.
  const goal = rules.energyGoal,
    gravity = rules.gravityPerMass;
  t.after(() => {
    rules.energyGoal = goal;
    rules.gravityPerMass = gravity;
  });
  rules.energyGoal = 100000;
  rules.gravityPerMass = 0;
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  } as Storage;
  const g = new Game(92043);
  g.start();
  while (g.time < 1200 && !g.result && (!g.choice || g.choice.number <= 25)) g.advance(250);
  assert.equal(g.choice?.number, 26);
  g.advance((g.choice!.deadline - g.time) * 1000 - 1000 / rules.tickRate);
  assert.ok(g.select(g.choice!.cards[0].id));
  g.advance(601000 - g.seconds * 1000);
  assert.ok(g.seconds > 600);
  assert.ok(g.level > 26);
  const restored = restoreCheckpoint(JSON.parse(JSON.stringify(createCheckpoint(g))))!;
  assert.ok(restored);
  assert.deepEqual(createCheckpoint(restored), createCheckpoint(g));
  restored.advance(1800000);
  g.advance(1800000);
  assert.equal(g.result?.outcome, 'success');
  assert.deepEqual(restored.result, g.result);
  const record = bestRecord(null, g.result!);
  save(storage, recordKey, record);
  assert.deepEqual(readRecord(storage), record);
});

test('ending phases replay at the same frame from a checkpoint', () => {
  const full = run(10004, 60);
  const collisionTick = Math.round(full.collisionTime * rules.tickRate);
  for (const extra of [0, 60, 210, 900]) {
    const g = new Game(10004);
    g.start();
    g.advance(((collisionTick + extra) * 1000) / rules.tickRate);
    const restored = restoreCheckpoint(createCheckpoint(g)!)!;
    assert.ok(restored);
    assert.equal(restored.phase, g.phase);
    assert.equal(restored.phaseProgress, g.phaseProgress);
    g.advance(16000);
    restored.advance(16000);
    assert.deepEqual(restored.result, g.result);
  }
});
