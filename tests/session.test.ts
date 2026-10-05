import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/app/session.ts';
import { Game } from '../src/game/model.ts';
import { createCheckpoint } from '../src/game/replay.ts';
import type { Result } from '../src/game/types.ts';

function session(game = new Game(10004), saveResult = (_result: Result) => true) {
  const saved: ReturnType<typeof createCheckpoint>[] = [];
  const heard: number[] = [];
  let draws = 0,
    suspends = 0,
    unlocks = 0,
    destroys = 0;
  const audio = {
    enabled: true,
    update: (_game: Game, from: number) => {
      heard.push(from);
    },
    unlock: async () => {
      unlocks++;
      return true;
    },
    suspend: () => {
      suspends++;
    },
    destroy: () => {
      destroys++;
    },
  };
  const run = new GameSession(game, audio, {
    sound: () => true,
    saveRun: (game) => {
      saved.push(createCheckpoint(game));
    },
    saveResult,
    redraw: () => {
      draws++;
    },
  });
  return { run, saved, heard, counts: () => ({ draws, suspends, unlocks, destroys }) };
}

test('loading gates input, frames retain catch-up ticks, and renderer recovery excludes lost time', () => {
  const { run } = session();
  run.begin(0);
  run.step(5000);
  assert.equal(run.game.phase, 'ready');
  assert.equal(run.game.elapsedTicks, 0);
  run.setRenderReady(true, 5000);
  run.begin(5000);
  const expected = new Game(10004);
  expected.start();
  expected.advance(1000);
  run.step(6000);
  assert.equal(run.game.elapsedTicks, 8);
  for (let i = 0; i < 7; i++) run.step(6000);
  assert.deepEqual(run.game.events, expected.events);
  run.game.debugSetXp(14);
  const choice = run.game.choice!;
  run.setRenderReady(false, 6000);
  run.select(choice.cards[0].id, choice.number);
  run.step(16000);
  assert.equal(run.game.choice, choice);
  assert.equal(run.game.elapsedTicks, 60);
  run.setRenderReady(true, 16000);
  run.select(choice.cards[0].id, choice.number);
  assert.equal(run.game.selections.length, 1);
  run.step(16000 + 1000 / 60);
  assert.equal(run.game.elapsedTicks, 61);
});

test('visibility and freeze save the run without consuming hidden time or undoing manual pause', () => {
  const { run, saved, counts } = session();
  run.setRenderReady(true, 0);
  run.begin(0);
  run.setHidden(true, 100);
  assert.equal(run.game.elapsedTicks, 6);
  assert.equal(saved.at(-1)?.ticks, 6);
  run.step(5000);
  run.setHidden(false, 5000);
  run.step(5100);
  assert.equal(run.game.elapsedTicks, 12);
  run.pause(true, 5100);
  const unlocks = counts().unlocks;
  run.suspend(5200);
  run.setHidden(false, 9000);
  run.setRenderReady(false, 9000);
  run.setRenderReady(true, 10000);
  run.step(11000);
  assert.equal(run.game.elapsedTicks, 12);
  assert.equal(counts().unlocks, unlocks);
  assert.equal(saved.at(-1)?.manualPaused, true);
  run.pause(false, 11000);
  run.step(11100);
  assert.equal(run.game.elapsedTicks, 18);
  run.suspend(11100);
  run.setHidden(false, 20000);
  run.step(20100);
  assert.equal(run.game.elapsedTicks, 24);
  run.dispose();
  assert.equal(counts().destroys, 1);
  assert.equal(saved.at(-1)?.ticks, 24);
});

test('audio consumes only new events and resets its cursor when the run is replaced', () => {
  const game = new Game(10004);
  game.start();
  game.advance(1000);
  const oldEvents = game.events.length;
  const { run, heard, counts } = session(game);
  run.setRenderReady(true, 1000);
  run.step(1100);
  assert.equal(heard[0], oldEvents);
  const events = game.events.length;
  run.step(1200);
  assert.equal(heard[1], events);
  const replacement = new Game(42);
  run.replace(replacement, 1300);
  run.begin(1300);
  run.step(1400);
  assert.equal(heard[2], 0);
  assert.equal(replacement.elapsedTicks, 6);
  assert.ok(counts().draws > 0);
});

test('periodic saves are bounded and a failed result write retries until it succeeds', () => {
  let attempts = 0;
  const game = new Game(42, { combat: false });
  const { run, saved } = session(game, () => ++attempts > 1);
  run.setRenderReady(true, 0);
  run.begin(0);
  run.step(1000);
  const saves = saved.length;
  run.step(1100);
  assert.equal(saved.length, saves);
  run.step(2000);
  assert.equal(saved.length, saves + 1);
  game.debugSetXp(game.rules.energyGoal);
  run.advance(10000, 2000);
  assert.equal(game.phase, 'result');
  run.step(2000);
  assert.equal(attempts, 1);
  run.step(2999);
  assert.equal(attempts, 1);
  run.step(3000);
  assert.equal(attempts, 2);
  run.step(10000);
  assert.equal(attempts, 2);
  const next = new Game(42, { combat: false });
  next.start();
  next.debugSetXp(next.rules.energyGoal);
  next.advance(10000);
  run.replace(next, 10000);
  run.step(10000);
  assert.equal(attempts, 3);
});
