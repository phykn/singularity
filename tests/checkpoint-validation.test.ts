import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import { rules } from '../src/game/rules.ts';

function checkpoint() {
  const game = new Game(1701);
  game.start();
  while (!game.choice) game.advance(1000 / rules.tickRate);
  return createCheckpoint(game)!;
}

test('current checkpoints reject malformed required fields without throwing', () => {
  const current = checkpoint();
  const invalid: unknown[] = [null, undefined, [], 1, 'checkpoint'];
  for (const [key, values] of Object.entries({
    seed: [undefined, null, -1, 0.5, 0x100000000, NaN, Infinity, '42'],
    startAngle: [undefined, NaN, Infinity, '0'],
    pendingTicks: [undefined, -1, NaN, Infinity, '0'],
    ticks: [undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '60'],
    phase: [undefined, 'ready', 'unknown'],
    manualPaused: [undefined, 'false', 0],
    retired: [undefined, 'false', 0],
    continuedAt: [undefined, -1, 0.5, Infinity, current.ticks + 1],
    choiceRemaining: [undefined, NaN, Infinity, '5'],
    inputs: [undefined, null, {}, [null], Array(1)],
    resonances: [undefined, null, {}, [null], Array(1)],
  }))
    for (const value of values) invalid.push({ ...current, [key]: value });
  for (const value of invalid) assert.equal(restoreCheckpoint(value), null);
  const restored = restoreCheckpoint(JSON.parse(JSON.stringify(current)));
  assert.ok(restored);
  assert.ok(Number.isFinite(restored.choice!.deadline));
  assert.deepEqual(createCheckpoint(restored), current);
});

test('current checkpoint choice and resonance inputs require their complete typed fields', () => {
  const game = new Game(1701);
  game.start();
  while (!game.choice) game.advance(1000 / rules.tickRate);
  assert.ok(game.select(game.choice.cards[0].id));
  assert.ok(game.resonate(1));
  const current = createCheckpoint(game)!;
  for (const [key, value] of Object.entries({
    tick: -1,
    id: 'missing-skill',
    number: 0,
    automatic: 'false',
    beforeCombat: 'false',
  })) {
    const input = { ...current.inputs[0], [key]: value };
    assert.equal(restoreCheckpoint({ ...current, inputs: [input] }), null);
    delete input[key as keyof typeof input];
    assert.equal(restoreCheckpoint({ ...current, inputs: [input] }), null);
  }
  for (const [key, value] of Object.entries({ tick: 0.5, selectionCount: -1, beat: 4 })) {
    const input = { ...current.resonances[0], [key]: value };
    assert.equal(restoreCheckpoint({ ...current, resonances: [input] }), null);
    delete input[key as keyof typeof input];
    assert.equal(restoreCheckpoint({ ...current, resonances: [input] }), null);
  }
  assert.deepEqual(createCheckpoint(restoreCheckpoint(current)!), current);
});
