import assert from 'node:assert/strict';
import test from 'node:test';
import { stationarySkill, target } from './helpers.ts';

test('satellites keep distinct targets and bounded selection work in a crowded tie', (ctx) => {
  let reads = 0;
  const targets = Array.from({ length: 800 }, (_, idx) => {
    const id = 799 - idx;
    const t = target(id, 180, 128, 1000);
    Object.defineProperty(t, 'id', {
      get() {
        reads++;
        return id;
      },
    });
    return t;
  });
  const g = stationarySkill({ satellite: 2, multi: 1 }, targets);
  assert.ok(g.combat.fireSkill('satellite'));
  assert.deepEqual(
    g.events
      .filter((event) => event.kind === 'hit')
      .map((event) => (event.data as { id: number }).id),
    [0, 1, 2, 3],
  );
  assert.ok(reads < 20000, `Selecting four targets required ${reads} target ID reads`);
  ctx.diagnostic(`Selecting four targets required ${reads} target ID reads`);
});

test('satellites fill remaining branches with nearest already reserved targets', () => {
  const g = stationarySkill({ satellite: 2, multi: 1 }, [
    target(1, 180, 128, 1000),
    target(0, 180, 128, 1000),
  ]);
  assert.ok(g.combat.fireSkill('satellite'));
  assert.deepEqual(
    g.events
      .filter((event) => event.kind === 'hit')
      .map((event) => (event.data as { id: number }).id),
    [0, 1, 0, 1],
  );
});
