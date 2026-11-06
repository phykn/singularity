import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Records,
  bestBeyond,
  bestRecord,
  keys,
  readBeyond,
  readLanguage,
  readRecord,
  readSound,
} from '../src/session/storage.ts';

function storage(values: Record<string, string> = {}, fail = () => false): Storage {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      if (fail()) throw new Error('quota');
      values[key] = value;
    },
  } as Storage;
}

test('language: saved value, then browser language, then English', () => {
  assert.equal(readLanguage(storage({ [keys.language]: '"ja"' }), ['ko-KR']), 'ja');
  assert.equal(readLanguage(storage({ [keys.language]: '"fr"' }), ['zh-TW']), 'zh');
  assert.equal(readLanguage(storage(), ['fr-FR', 'ko']), 'en');
  assert.equal(readLanguage(storage({ [keys.language]: '{' }), []), 'en');
});

test('sound is on unless saved off', () => {
  assert.equal(readSound(storage()), true);
  assert.equal(readSound(storage({ [keys.sound]: 'false' })), false);
  assert.equal(readSound(storage({ [keys.sound]: 'nonsense' })), true);
});

// Values exactly as the old game wrote them.
const oldRecord = { outcome: 'success', xp: 5200, level: 31, seed: 12345, collisionTime: 1010.5 },
  oldBeyond = { seconds: 214.25, xp: 900, seed: 777 };
const finished = (o: Partial<Parameters<typeof bestRecord>[1]> = {}) => ({
  outcome: 'collapse-failure',
  xp: 100,
  level: 5,
  seed: 1,
  collisionTime: 300,
  endless: null,
  ...o,
});

test('old saved records read back; broken ones read as none', () => {
  const s = storage({
    [keys.record]: JSON.stringify(oldRecord),
    [keys.beyond]: JSON.stringify(oldBeyond),
  });
  assert.deepEqual(readRecord(s), oldRecord);
  assert.deepEqual(readBeyond(s), oldBeyond);
  for (const broken of ['{', '"x"', JSON.stringify({ ...oldRecord, outcome: 'won' })])
    assert.equal(readRecord(storage({ [keys.record]: broken })), null, broken);
  assert.equal(
    readRecord(storage({ [keys.record]: JSON.stringify({ ...oldRecord, xp: -1 }) })),
    null,
  );
  assert.equal(readBeyond(storage({ [keys.beyond]: JSON.stringify({ seconds: 'a' }) })), null);
});

test('a clear beats a loss, then XP, then a later end; endless runs count only beyond', () => {
  const loss = bestRecord(null, finished())!;
  assert.equal(bestRecord(loss, finished({ xp: 50 })), loss);
  assert.equal(bestRecord(loss, finished({ xp: 100, collisionTime: 400 }))!.collisionTime, 400);
  const clear = bestRecord(loss, finished({ outcome: 'success', xp: 10 }))!;
  assert.equal(clear.outcome, 'success');
  assert.equal(bestRecord(clear, finished({ xp: 9999 })), clear);
  const endless = finished({ outcome: 'success', xp: 9999, endless: { seconds: 60, xp: 40 } });
  assert.equal(bestRecord(clear, endless), clear);
  const beyond = bestBeyond(null, endless)!;
  assert.deepEqual(beyond, { seconds: 60, xp: 40, seed: 1 });
  assert.equal(bestBeyond(beyond, finished({ endless: { seconds: 60, xp: 10 } })), beyond);
  assert.equal(bestBeyond(beyond, finished()), beyond);
});

test('records merge what another tab stored and retry a failed write once a second', () => {
  const values: Record<string, string> = {};
  let failing = true;
  const records = new Records(() => storage(values, () => failing));
  assert.equal(records.record(finished({ xp: 300 }), 0), false);
  assert.equal(records.best!.xp, 300, 'kept in memory');
  assert.equal(records.improved, true);
  values[keys.record] = JSON.stringify(oldRecord); // a better record from another tab
  failing = false;
  assert.equal(records.retry(500), undefined, 'too early: nothing is attempted');
  assert.equal(values[keys.record], JSON.stringify(oldRecord));
  assert.equal(records.retry(1000), true);
  assert.deepEqual(JSON.parse(values[keys.record]), oldRecord);
  assert.deepEqual(records.best, oldRecord);
  records.record(finished({ xp: 200 }), 2000);
  assert.equal(records.improved, false);
  assert.equal(records.retry(4000), undefined, 'nothing pending');
});
