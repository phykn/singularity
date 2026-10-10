import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import type { Result } from '../src/game/types.ts';
import { ResultRecords } from '../src/app/ResultRecords.ts';
import { recordKey, beyondRecordKey } from '../src/app/storage.ts';

const game = new Game(1, { combat: false });
game.start();
game.debugSetXp(game.rules.energyGoal);
game.advance(10000);
const normal = (xp: number, seed = 1): Result => ({ ...game.result!, xp, seed });
const endless = (seconds: number, xp: number, seed = 1): Result => ({
  ...normal(xp, seed),
  outcome: 'retired',
  endless: { seconds, xp },
});

function memory() {
  const values = new Map<string, string>();
  const attempts: string[] = [];
  const reports: [string, boolean][] = [];
  let writable = true,
    changes = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      attempts.push(key);
      if (!writable) throw new Error('blocked');
      values.set(key, value);
    },
  } as Storage;
  const records = new ResultRecords(
    () => storage,
    (key, ok) => reports.push([key, ok]),
    () => changes++,
  );
  return {
    records,
    storage,
    values,
    attempts,
    reports,
    changes: () => changes,
    writable: (value: boolean) => (writable = value),
  };
}

test('failed results coalesce into two bounded retries and preserve earlier stronger records', () => {
  const store = memory();
  store.writable(false);
  store.records.record(normal(200, 2), 0);
  store.records.record(endless(200, 20, 3), 0);
  for (let i = 1; i <= 100; i++) {
    store.records.record(normal(100, 4), i);
    store.records.record(endless(100, 10, 5), i);
  }
  assert.equal(store.records.best?.xp, 200);
  assert.equal(store.records.beyond?.seconds, 200);
  assert.equal(store.changes(), 2);
  assert.ok(!('selections' in store.records.best!));
  assert.deepEqual(Object.keys(store.records.beyond!).sort(), ['seconds', 'seed', 'xp']);
  const before = store.attempts.length;
  store.records.retry(1099);
  assert.equal(store.attempts.length, before);
  store.records.retry(1100);
  assert.deepEqual(store.attempts.slice(before), [recordKey, beyondRecordKey]);
  store.records.retry(1100);
  assert.equal(store.attempts.length, before + 2);
  store.writable(true);
  store.records.retry(2100);
  assert.equal(JSON.parse(store.values.get(recordKey)!).xp, 200);
  assert.equal(JSON.parse(store.values.get(beyondRecordKey)!).seconds, 200);
  assert.deepEqual(store.reports.slice(-2), [
    [recordKey, true],
    [beyondRecordKey, true],
  ]);
  const saved = store.attempts.length;
  store.records.retry(10000);
  assert.equal(store.attempts.length, saved);
});

test('sequential stale owners merge normal and endless best records before writes and retries', () => {
  const store = memory();
  const stale = new ResultRecords(
    () => store.storage,
    () => {},
    () => {},
  );
  store.records.record(normal(200, 2), 0);
  store.records.record(endless(200, 20, 3), 0);
  stale.record(normal(100, 4), 0);
  stale.record(endless(100, 10, 5), 0);
  assert.equal(stale.best?.seed, 2);
  assert.equal(stale.beyond?.seed, 3);
  store.writable(false);
  stale.record(normal(300, 6), 100);
  stale.record(endless(300, 30, 7), 100);
  store.writable(true);
  store.records.record(normal(400, 8), 200);
  store.records.record(endless(400, 40, 9), 200);
  stale.retry(1100);
  assert.equal(stale.best?.seed, 8);
  assert.equal(stale.beyond?.seed, 9);
  assert.equal(JSON.parse(store.values.get(recordKey)!).xp, 400);
  assert.equal(JSON.parse(store.values.get(beyondRecordKey)!).seconds, 400);
});

test('storage access failures retain records in memory and recover through retry', () => {
  const store = memory();
  let accessible = false;
  const reports: boolean[] = [];
  const records = new ResultRecords(
    () => {
      if (!accessible) throw new Error('storage accessor blocked');
      return store.storage;
    },
    (_key, ok) => reports.push(ok),
    () => {},
  );
  assert.equal(records.best, null);
  assert.equal(records.beyond, null);
  records.record(normal(200), 0);
  records.record(endless(20, 10), 0);
  assert.equal(records.best?.xp, 200);
  assert.equal(records.beyond?.seconds, 20);
  accessible = true;
  records.retry(1000);
  assert.deepEqual(reports, [false, false, true, true]);
  const loaded = new ResultRecords(
    () => store.storage,
    () => {},
    () => {},
  );
  assert.deepEqual(loaded.best, records.best);
  assert.deepEqual(loaded.beyond, records.beyond);
});

test('record rankings keep normal clears separate and use the existing tie breakers', () => {
  const store = memory();
  store.records.record({ ...normal(100), outcome: 'collapse-failure' }, 0);
  store.records.record(normal(50), 0);
  assert.equal(store.records.best?.outcome, 'success');
  store.records.record({ ...normal(50, 2), collisionTime: 1000 }, 0);
  assert.equal(store.records.best?.seed, 2);
  store.records.record(endless(20, 10, 3), 0);
  store.records.record(endless(20, 11, 4), 0);
  assert.equal(store.records.beyond?.seed, 4);
  assert.equal(store.records.best?.seed, 2);
});
