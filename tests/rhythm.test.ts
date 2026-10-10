import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitRhythm, rhythmTiming as t } from '../src/app/OrbitRhythm.ts';
import { GameSession } from '../src/app/GameSession.ts';
import { Game } from '../src/game/Game.ts';
import { fixture } from './helpers.ts';

function advance(r: OrbitRhythm, ms: number) {
  while (ms > 0) {
    const step = Math.min(10, ms);
    r.advance(step, true);
    ms -= step;
  }
}

test('three separate beats complete once; early or extra taps cannot farm rewards', () => {
  const r = new OrbitRhythm();
  advance(r, t.intro + t.lead);
  assert.equal(r.tap(), 'hit');
  advance(r, t.interval);
  assert.equal(r.tap(), 'hit');
  advance(r, t.interval);
  assert.equal(r.tap(), 'complete');
  assert.equal(r.completed, 1);
  assert.equal(r.tap(), 'ignored');
  advance(r, t.rest - 10);
  assert.equal(r.active, false);
  advance(r, 10);
  assert.equal(r.active, true);
  assert.equal(r.tap(), 'miss');
  assert.equal(r.completed, 1);
  advance(r, t.rest + t.lead);
  assert.equal(r.tap(), 'hit');
  assert.equal(r.tap(), 'miss');
  assert.equal(r.tap(), 'ignored');
});

test('window edges are inclusive and missed beats end without affecting the next phrase', () => {
  for (const offset of [-t.window, t.window]) {
    const r = new OrbitRhythm();
    advance(r, t.intro + t.lead + offset);
    assert.equal(r.tap(), 'hit');
    advance(r, t.interval);
    assert.equal(r.tap(), 'hit');
    advance(r, t.interval);
    assert.equal(r.tap(), 'complete');
  }
  const r = new OrbitRhythm();
  advance(r, t.intro + t.lead + t.window + 10);
  assert.equal(r.active, false);
  assert.equal(r.completed, 0);
  assert.equal(r.feedback, 'miss');
});

test('interruptions and long frames cancel without a failure, followed by a fresh lead-in', () => {
  for (const interrupt of [
    (r: OrbitRhythm) => r.advance(10, false),
    (r: OrbitRhythm) => r.advance(500, true),
  ]) {
    const r = new OrbitRhythm();
    advance(r, t.intro + t.lead);
    r.tap();
    interrupt(r);
    assert.equal(r.active, false);
    assert.equal(r.feedback, null);
    assert.equal(r.hits, 0);
    advance(r, 1200);
    assert.equal(r.age, 0);
    assert.equal(r.active, true);
    assert.equal(r.open, false);
    advance(r, t.lead);
    assert.equal(r.tap(), 'hit');
  }
});

function session(game = fixture()) {
  const audio = {
    enabled: false,
    update() {},
    suspend() {},
    destroy() {},
    async unlock() {
      return true;
    },
    play() {},
  };
  const session = new GameSession(game, audio, {
    sound: () => false,
    saveResult: () => true,
    redraw() {},
  });
  session.setRenderReady(true, 0);
  return session;
}

test('real-time rhythm is unchanged by playback speed and cannot consume choices or pauses', () => {
  for (const speed of [1, 1.5, 2] as const) {
    const s = session();
    s.playbackSpeed = speed;
    // Battle choices are intentionally absent here; the clock must stay in real time.
    s.game.radius = 132;
    s.game.mass = 0;
    for (let wall = 10; wall <= t.intro + t.lead; wall += 10) {
      s.game.targets = [];
      s.step(wall);
    }
    assert.equal(s.rhythm.age, t.lead);
    s.tapRhythm(t.intro + t.lead);
    assert.equal(s.rhythm.hits, 1);
    s.game.debugSetXp(14);
    s.pauseOnChoice = false;
    s.tapRhythm(t.intro + t.lead + 10);
    assert.equal(s.rhythm.active, false);
    assert.equal(s.rhythm.feedback, null);
    assert.equal(s.game.resonances.length, 0);
    s.pause(true, t.intro + t.lead + 10);
    s.tapRhythm(t.intro + t.lead + 1000);
    assert.equal(s.game.resonances.length, 0);
  }
});

test('unattended rhythm does not change the automatic simulation', () => {
  const g = new Game(20261010);
  g.start();
  const s = session(g);
  s.pauseOnChoice = false;
  for (let i = 1; i <= 1800; i++) s.step((i * 1000) / 60);
  const expected = new Game(20261010);
  expected.start();
  for (let i = 1; i <= 1800; i++) expected.advance(1000 / 60);
  assert.equal(g.elapsedTicks, expected.elapsedTicks);
  assert.deepEqual(g.events, expected.events);
  assert.deepEqual(g.targets, expected.targets);
  assert.deepEqual(g.resonances, []);
});

test('hidden tabs, renderer loss, new runs and endings discard an unfinished phrase', () => {
  for (const interrupt of [
    (s: GameSession) => s.setHidden(true, 0),
    (s: GameSession) => s.setRenderReady(false, 0),
    (s: GameSession) => s.pause(true, 0),
    (s: GameSession) => {
      s.game.phase = 'collapse';
      s.step(0);
    },
  ]) {
    const s = session();
    advance(s.rhythm, t.intro + t.lead);
    s.tapRhythm(0);
    assert.equal(s.rhythm.hits, 1);
    interrupt(s);
    assert.equal(s.rhythm.active, false);
    assert.equal(s.rhythm.feedback, null);
    s.tapRhythm(10);
    assert.equal(s.game.resonances.length, 0);
  }
  const s = session();
  advance(s.rhythm, t.intro + t.lead);
  s.rhythm.tap();
  s.replace(new Game(912), 0);
  assert.equal(s.rhythm.active, false);
  assert.equal(s.rhythm.completed, 0);
});
