import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { playRhythm } from '../scripts/rhythm-bot.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';

test('the balance reference uses successful session inputs and reproduces the recorded game', () => {
  const game = new Game(140005);
  const played = playRhythm(game);
  assert.ok(game.result);
  assert.equal(played.misses, 0);
  assert.ok(played.completed > 0);
  assert.equal(played.completed, game.resonances.filter((r) => r.beat === 3).length);
  assert.equal(played.hits, game.resonances.length);
  assert.ok(played.wallSeconds > game.seconds, 'Real hit stop is included in the reference');
  const restored = restoreCheckpoint(createCheckpoint(game)!)!;
  assert.ok(restored);
  assert.deepEqual(restored.result, game.result);
  assert.deepEqual(restored.targets, game.targets);
  const again = new Game(140005);
  assert.deepEqual(playRhythm(again), played);
  assert.deepEqual(again.resonances, game.resonances);
  assert.deepEqual(again.result, game.result);
});
