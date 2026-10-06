import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/app/GameSession.ts';
import { Game } from '../src/game/Game.ts';
import type { Result } from '../src/game/types.ts';

function session(game = new Game(10004), saveResult = (_result: Result) => true) {
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
    saveResult,
    redraw: () => {
      draws++;
    },
  });
  return { run, heard, counts: () => ({ draws, suspends, unlocks, destroys }) };
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

test('title launch runs once for 300ms before combat and freezes with hidden or unavailable rendering', () => {
  const { run } = session();
  run.launch(0);
  assert.equal(run.launchProgress, null);
  run.setRenderReady(true, 0);
  run.launch(0);
  run.step(100);
  assert.ok(Math.abs(run.launchProgress! - 1 / 3) < 1e-8);
  run.launch(100);
  run.setHidden(true, 100);
  run.step(5000);
  assert.ok(Math.abs(run.launchProgress! - 1 / 3) < 1e-8);
  run.setHidden(false, 5000);
  run.setRenderReady(false, 5000);
  run.step(10000);
  assert.equal(run.game.phase, 'ready');
  assert.equal(run.game.elapsedTicks, 0);
  run.setRenderReady(true, 10000);
  run.step(10199);
  assert.equal(run.game.phase, 'ready');
  run.step(10200);
  assert.equal(run.launchProgress, null);
  assert.equal(run.game.phase, 'running');
  assert.equal(run.game.elapsedTicks, 0);
  assert.equal(run.game.events.filter((event) => event.kind === 'start').length, 1);
  run.step(10200 + 1000 / 60);
  assert.equal(run.game.elapsedTicks, 1);
  run.launch(10250);
  assert.equal(run.launchProgress, null);
  run.replace(new Game(24), 11000);
  run.launch(11000);
  run.step(11100);
  run.replace(new Game(25), 11100);
  assert.equal(run.launchProgress, null);
  run.step(12000);
  assert.equal(run.game.phase, 'ready');
});

test('visibility and freeze preserve the live run without consuming hidden time or undoing manual pause', () => {
  const { run, counts } = session();
  run.setRenderReady(true, 0);
  run.begin(0);
  run.setHidden(true, 100);
  assert.equal(run.game.elapsedTicks, 6);
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
  assert.equal(run.game.manualPaused, true);
  run.pause(false, 11000);
  run.step(11100);
  assert.equal(run.game.elapsedTicks, 18);
  run.suspend(11100);
  run.setHidden(false, 20000);
  run.step(20100);
  assert.equal(run.game.elapsedTicks, 24);
  run.dispose();
  assert.equal(counts().destroys, 1);
  assert.equal(run.game.elapsedTicks, 24);
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

test('a failed best-result write retries until it succeeds', () => {
  let attempts = 0;
  const game = new Game(42, { combat: false });
  const { run } = session(game, () => ++attempts > 1);
  run.setRenderReady(true, 0);
  run.begin(0);
  run.step(1000);
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

test('playback speeds advance the same simulation at 30 and 60fps without changing stats', () => {
  for (const fps of [30, 60]) {
    for (const speed of [1, 1.5, 2]) {
      const { run } = session();
      run.setRenderReady(true, 0);
      run.begin(0);
      while (run.playbackSpeed !== speed) run.cycleSpeed(0);
      for (let frame = 1; frame <= fps; frame++) run.step((frame * 1000) / fps);
      const expected = new Game(10004);
      expected.start();
      expected.advance(1000 * speed);
      assert.equal(run.game.elapsedTicks, 60 * speed);
      assert.deepEqual(run.game.events, expected.events);
      assert.deepEqual(run.game.targets, expected.targets);
      assert.equal(run.game.rate, expected.rate);
      assert.equal(run.game.speed, expected.speed);
    }
  }
});

test('speed changes settle the old interval and preserve pause, visibility and fresh-run behavior', () => {
  const { run } = session();
  run.setRenderReady(true, 0);
  run.begin(0);
  run.cycleSpeed(50);
  assert.equal(run.game.elapsedTicks, 3);
  assert.equal(run.playbackSpeed, 1.5);
  run.cycleSpeed(150);
  run.step(150); // Drain retained catch-up ticks without adding wall time.
  assert.equal(run.game.elapsedTicks, 12);
  assert.equal(run.playbackSpeed, 2);
  run.setHidden(true, 200);
  assert.equal(run.game.elapsedTicks, 18);
  run.step(5000);
  assert.equal(run.game.elapsedTicks, 18);
  run.setHidden(false, 5000);
  run.step(5050);
  assert.equal(run.game.elapsedTicks, 24);
  run.pause(true, 5050);
  run.step(9000);
  assert.equal(run.game.elapsedTicks, 24);
  assert.equal(run.playbackSpeed, 2);
  run.pause(false, 9000);
  run.step(9050);
  assert.equal(run.game.elapsedTicks, 30);
  run.cycleSpeed(9050);
  assert.equal(run.playbackSpeed, 1);
  run.cycleSpeed(9050);
  run.replace(new Game(42), 9050);
  assert.equal(run.playbackSpeed, 1);
});

test('choice pause freezes both world and countdown while cards stay selectable', () => {
  const { run } = session();
  run.setRenderReady(true, 0);
  run.begin(0);
  run.game.debugSetXp(14);
  const choice = structuredClone(run.game.choice);
  const frozen = structuredClone({
    targets: run.game.targets,
    angle: run.game.angle,
    effects: run.game.effects,
  });
  run.step(20000);
  assert.equal(run.game.tick, 0);
  assert.deepEqual(run.game.choice, choice);
  assert.deepEqual(
    { targets: run.game.targets, angle: run.game.angle, effects: run.game.effects },
    frozen,
  );
  run.select(run.game.choice!.cards[0].id, run.game.choice!.number);
  assert.equal(run.game.selections.length, 1);
  run.step(20000 + 1000 / 60);
  assert.equal(run.game.tick, 1);
});

test('choice toggles preserve remaining time and auto-pick after five running wall seconds at every speed', () => {
  for (const speed of [1, 1.5, 2]) {
    const { run } = session(new Game(42, { combat: false }));
    run.setRenderReady(true, 0);
    run.begin(0);
    run.game.debugSetXp(14);
    const expected = run.game.automaticCard!.id;
    while (run.playbackSpeed !== speed) run.cycleSpeed(0);
    run.step(1000);
    assert.equal(run.game.choice!.deadline - run.game.time, 5);
    run.toggleChoicePause(1000);
    for (let i = 1; i <= 120; i++) run.step(1000 + (i * 1000) / 60);
    assert.equal(run.game.tick, 120 * speed);
    const remaining = run.game.choice!.deadline - run.game.time;
    assert.ok(Math.abs(remaining - 3) < 1e-8);
    run.toggleChoicePause(3000);
    run.step(23000);
    assert.equal(run.game.tick, 120 * speed);
    assert.equal(run.game.choice!.deadline - run.game.time, remaining);
    run.toggleChoicePause(23000);
    for (let i = 1; i <= 179; i++) run.step(23000 + (i * 1000) / 60);
    assert.ok(run.game.choice);
    run.step(26000);
    assert.equal(run.game.choice, null);
    assert.equal(run.game.selections[0].automatic, true);
    assert.equal(run.game.selections[0].id, expected);
    run.replace(new Game(24), 26000);
    assert.equal(run.pauseOnChoice, true);
  }
});

test('manual pause, backgrounding and renderer loss preserve the running selection timer', () => {
  const { run } = session();
  run.setRenderReady(true, 0);
  run.begin(0);
  run.game.debugSetXp(14);
  run.toggleChoicePause(0);
  for (let i = 1; i <= 60; i++) run.step((i * 1000) / 60);
  const remaining = run.game.choice!.deadline - run.game.time;
  assert.ok(Math.abs(remaining - 4) < 1e-8);
  run.pause(true, 1000);
  run.step(9000);
  run.pause(false, 9000);
  run.setHidden(true, 9000);
  run.step(17000);
  run.setHidden(false, 17000);
  run.setRenderReady(false, 17000);
  run.step(25000);
  run.setRenderReady(true, 25000);
  assert.equal(run.game.choice!.deadline - run.game.time, remaining);
  for (let i = 1; i <= 60; i++) run.step(25000 + (i * 1000) / 60);
  assert.ok(Math.abs(run.game.choice!.deadline - run.game.time - 3) < 1e-8);
});

test('a new choice stops retained frame ticks and a charged run proceeds to its ending', () => {
  const { run } = session();
  run.setRenderReady(true, 0);
  run.begin(0);
  const g = run.game;
  for (const target of g.targets) target.xp = 14;
  for (let frame = 1; frame <= 60 && !g.choice; frame++) run.step((frame * 1000) / 60);
  assert.ok(g.choice);
  const tick = g.tick;
  run.select(g.choice.cards[0].id, g.choice.number);
  run.step((tick * 1000) / 60);
  assert.equal(g.tick, tick, 'Paused frames must not catch up after selection');
  g.debugSetXp(g.rules.energyGoal);
  run.advance(10000, 11000);
  assert.equal(g.phase, 'result');
});
