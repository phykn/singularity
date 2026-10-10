import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitRhythm, rhythmTiming as t } from '../src/app/OrbitRhythm.ts';
import { GameSession } from '../src/app/GameSession.ts';
import { Game } from '../src/game/Game.ts';
import { fixture, target } from './helpers.ts';

function advance(r: OrbitRhythm, ms: number) {
  while (ms > 0) {
    const step = Math.min(10, ms);
    r.advance(step, true, r.angle + step * 0.001, 0.001);
    ms -= step;
  }
}

function phrases(r: OrbitRhythm, count = 20) {
  const result: { gaps: number[]; rest: number }[] = [];
  for (let i = 0; i < count; i++) {
    let rest = 0;
    while (!r.active) {
      advance(r, 10);
      rest += 10;
    }
    advance(r, r.due - r.age);
    const gaps = [];
    assert.equal(r.tap(), 'hit');
    for (let beat = 2; beat <= 3; beat++) {
      gaps.push(Math.round(r.due - r.age));
      advance(r, r.due - r.age);
      assert.equal(r.tap(), beat === 3 ? 'complete' : 'hit');
    }
    result.push({ gaps, rest });
  }
  return result;
}

test('seeded phrases vary readable short and long gaps without consecutive repeated patterns', () => {
  const trace = phrases(new OrbitRhythm(1701));
  assert.deepEqual(phrases(new OrbitRhythm(1701)), trace);
  assert.notDeepEqual(phrases(new OrbitRhythm(1702)), trace);
  assert.ok(new Set(trace.map((p) => p.gaps.join(','))).size >= 4);
  for (const [i, phrase] of trace.entries()) {
    assert.ok(phrase.gaps.every((gap) => gap >= 550 && gap <= 1000));
    assert.notEqual(phrase.gaps[0], phrase.gaps[1]);
    if (i) {
      assert.notDeepEqual(phrase.gaps, trace[i - 1].gaps);
      assert.ok(phrase.rest >= t.restMin && phrase.rest <= t.restMax + 10);
    }
  }
});

test('three separate beats complete once; early or extra taps cannot farm rewards', () => {
  const r = new OrbitRhythm();
  advance(r, t.intro + t.lead);
  assert.equal(r.tap(), 'hit');
  advance(r, r.due - r.age);
  assert.equal(r.tap(), 'hit');
  advance(r, r.due - r.age);
  assert.equal(r.tap(), 'complete');
  assert.equal(r.completed, 1);
  assert.equal(r.tap(), 'ignored');
  advance(r, t.restMin - 10);
  assert.equal(r.active, false);
  while (!r.active) advance(r, 10);
  assert.equal(r.active, true);
  assert.equal(r.tap(), 'miss');
  assert.equal(r.completed, 1);
  while (!r.active) advance(r, 10);
  advance(r, r.due - r.age);
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
    advance(r, r.due - r.age + offset);
    assert.equal(r.tap(), 'hit');
    advance(r, r.due - r.age + offset);
    assert.equal(r.tap(), 'complete');
  }
  const r = new OrbitRhythm();
  advance(r, t.intro + t.lead + t.window + 10);
  assert.equal(r.active, true, 'An untouched gate remains available on the next orbit');
  assert.equal(r.completed, 0);
  assert.equal(r.feedback, null);
  advance(r, r.due - r.age);
  assert.equal(r.tap(), 'hit');
  advance(r, r.due - r.age + t.window + 10);
  assert.equal(r.feedback, 'miss');
});

test('every visible electron crossing is accepted on its first lap, even on fast orbits', () => {
  for (const velocity of [0.001, 0.004, 0.012, 0.025, 0.05]) {
    const r = new OrbitRhythm(421);
    const step = () => r.advance(5, true, r.angle + velocity * 5, velocity);
    for (let ms = 0; ms < t.intro; ms += 5) step();
    for (let beat = 1; beat <= 3; beat++) {
      const gate = r.gateAngle;
      assert.equal(r.open, false, 'The next gate must not overlap the current electron');
      const visualDistance = () =>
        Math.abs(Math.atan2(Math.sin(r.angle - gate), Math.cos(r.angle - gate)));
      let frames = 0;
      while (visualDistance() > r.windowAngle + 1e-9 && frames++ < 2000) step();
      assert.ok(frames < 2000);
      assert.equal(r.gateAngle, gate, 'Only the electron moves, not the target');
      assert.equal(r.open, true, `Visible crossing rejected at velocity ${velocity}, beat ${beat}`);
      assert.equal(r.tap(), beat === 3 ? 'complete' : 'hit');
      assert.equal(r.tap(), 'ignored', 'One input must never count twice');
    }
  }
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
    recordResult() {},
    audioUnlocked() {},
    redraw() {},
  });
  session.setRenderReady(true, 0);
  return session;
}

test('session construction and run replacement reset the independent rhythm seed', () => {
  const first = session(new Game(1701));
  assert.deepEqual(phrases(first.rhythm, 5), phrases(new OrbitRhythm(1701), 5));
  first.replace(new Game(1702), 0);
  assert.deepEqual(phrases(first.rhythm, 5), phrases(new OrbitRhythm(1702), 5));
});

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
    assert.equal(s.rhythm.feedback, 'hit', 'A level-up must not erase the successful judgment');
    assert.equal(s.game.resonances.length, 1);
    s.pause(true, wall + 10);
    s.tapRhythm(wall + 1000);
    assert.equal(s.game.resonances.length, 1);
  }
});

test('successful input briefly stops combat while judgment keeps animating, then resumes without catch-up', () => {
  for (const speed of [1, 2] as const) {
    const s = session();
    s.playbackSpeed = speed;
    let wall = 0;
    while (!s.rhythm.open && wall < 10000) {
      wall += 10;
      s.step(wall);
    }
    assert.ok(s.rhythm.open);
    s.tapRhythm(wall);
    const tick = s.game.elapsedTicks;
    const angle = s.game.angle;
    s.step(wall + 20);
    assert.equal(s.game.elapsedTicks, tick);
    assert.equal(s.game.angle, angle);
    assert.equal(s.rhythm.feedbackAge, 20);
    s.step(wall + 60);
    assert.ok(s.game.elapsedTicks > tick);
    assert.ok(s.game.elapsedTicks - tick <= Math.ceil(0.025 * speed * s.game.rules.tickRate));

    while (!s.rhythm.open && wall < 10000) {
      wall += 10;
      s.step(wall + 60);
    }
    s.tapRhythm(wall + 60);
    assert.equal(s.rhythm.hits, 2);
    const beforeBacklog = s.game.elapsedTicks;
    s.game.advance(1000, 0);
    s.step(wall + 80);
    assert.equal(
      s.game.elapsedTicks,
      beforeBacklog,
      'Retained ticks must also wait during hit stop',
    );
  }
});

test('a successful QTE that reaches the XP goal keeps its visible judgment through charging', () => {
  const s = session();
  let wall = 0;
  for (let beat = 1; beat <= 3; beat++) {
    while (!(s.rhythm.open && s.rhythm.due <= s.rhythm.age) && wall < 15000) {
      wall += 5;
      s.game.targets = [];
      s.step(wall);
    }
    assert.ok(s.rhythm.open);
    if (beat === 3) {
      s.game.xp = s.game.rules.energyGoal - 1;
      s.game.targets = [target(900, s.game.position.x, s.game.position.y, 1)];
      s.game.counts.quark.generated++;
    }
    s.tapRhythm(wall);
  }
  assert.equal(s.game.charged, true);
  s.step(wall + 5);
  assert.equal(s.rhythm.active, false);
  assert.equal(s.rhythm.feedback, 'complete');
  assert.equal(s.rhythm.feedbackAge, 5);
  s.tapRhythm(wall + 10);
  assert.equal(s.game.resonances.length, 3);
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
