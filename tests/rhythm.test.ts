import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitRhythm, rhythmTiming as t } from '../src/app/OrbitRhythm.ts';
import { GameSession } from '../src/app/GameSession.ts';
import { Game } from '../src/game/Game.ts';
import { fixture } from './helpers.ts';

function advance(r: OrbitRhythm, ms: number) {
  while (ms > 0) {
    const step = Math.min(10, ms);
    r.advance(step, true, r.angle + step * 0.001, 0.001);
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
  assert.equal(r.tap(), 'ignored');
  advance(r, 260);
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
  assert.equal(r.active, true, 'An untouched gate remains available on the next orbit');
  assert.equal(r.completed, 0);
  assert.equal(r.feedback, null);
  advance(r, r.due - r.age);
  assert.equal(r.tap(), 'hit');
  advance(r, t.interval + t.window + 10);
  assert.equal(r.feedback, 'miss');
});

test('fast orbits retain readable beat spacing and reject earlier laps and duplicate taps', () => {
  const r = new OrbitRhythm();
  const velocity = 0.025;
  const step = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 10)
      r.advance(10, true, r.angle + velocity * 10, velocity);
  };
  step(t.intro);
  const gate = r.gateAngle;
  step(400);
  assert.equal(r.open, false);
  assert.equal(r.gateAngle, gate, 'The gate stays still instead of becoming another cursor');
  step(t.lead - 400);
  assert.equal(r.tap(), 'hit');
  assert.equal(r.tap(), 'ignored');
  step(t.interval);
  assert.equal(r.tap(), 'hit');
  step(t.interval);
  assert.equal(r.tap(), 'complete');
});

test('interruptions and long frames cancel without a failure, followed by a fresh lead-in', () => {
  for (const interrupt of [
    (r: OrbitRhythm) => r.advance(10, false, r.angle, 0.001),
    (r: OrbitRhythm) => r.advance(500, true, r.angle, 0.001),
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

test('the real electron enters a fixed gate at every playback speed; choices and pauses cannot consume input', () => {
  for (const speed of [1, 1.5, 2] as const) {
    const s = session();
    s.playbackSpeed = speed;
    // Battle choices are intentionally absent here; the clock must stay in real time.
    s.game.radius = 132;
    s.game.mass = 0;
    let wall = 0;
    for (; wall <= 10000; wall += 10) {
      s.game.targets = [];
      s.step(wall);
      if (s.rhythm.open) break;
    }
    assert.ok(wall < 10000);
    assert.ok(Math.abs(s.game.angle - s.rhythm.gateAngle) <= s.rhythm.windowAngle);
    s.tapRhythm(wall);
    assert.equal(s.rhythm.hits, 1);
    s.game.debugSetXp(14);
    s.pauseOnChoice = false;
    s.tapRhythm(wall + 10);
    assert.equal(s.rhythm.active, false);
    assert.equal(s.rhythm.feedback, null);
    assert.equal(s.game.resonances.length, 1);
    s.pause(true, wall + 10);
    s.tapRhythm(wall + 1000);
    assert.equal(s.game.resonances.length, 1);
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

test('changing playback speed cancels an in-progress phrase without a miss or reward', () => {
  const s = session();
  advance(s.rhythm, t.intro + 100);
  s.game.angle = s.rhythm.angle;
  assert.equal(s.rhythm.active, true);
  s.cycleSpeed(0);
  assert.equal(s.playbackSpeed, 1.5);
  assert.equal(s.rhythm.active, false);
  assert.equal(s.rhythm.feedback, null);
  assert.equal(s.game.resonances.length, 0);
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
    s.game.angle = s.rhythm.angle;
    s.tapRhythm(0);
    assert.equal(s.rhythm.hits, 1);
    interrupt(s);
    assert.equal(s.rhythm.active, false);
    assert.equal(s.rhythm.feedback, null);
    s.tapRhythm(10);
    assert.equal(s.game.resonances.length, 1);
  }
  const s = session();
  advance(s.rhythm, t.intro + t.lead);
  s.rhythm.tap();
  s.replace(new Game(912), 0);
  assert.equal(s.rhythm.active, false);
  assert.equal(s.rhythm.completed, 0);
});
