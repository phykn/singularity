import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { Session, frameTickLimit } from '../src/session/Session.ts';
import type { SessionAudio } from '../src/session/Session.ts';

function session(sound = true) {
  const log: string[] = [];
  const audio: SessionAudio = {
    enabled: false,
    unlock: async () => (log.push('unlock'), true),
    suspend: () => log.push('suspend'),
    update: () => {},
    play: (kind) => log.push(kind),
    destroy: () => {},
  };
  const s = new Session(new Game(7), audio, {
    sound: () => sound,
    audioFailed: () => log.push('failed'),
    record: () => log.push('record'),
    redraw: () => {},
  });
  s.setReady(true, 0);
  return { s, log };
}

test('speed cycles 1, 1.5, 2 and back to 1', () => {
  const { s } = session();
  const seen = [s.speed];
  for (let i = 0; i < 3; i++) (s.cycleSpeed(0), seen.push(s.speed));
  assert.deepEqual(seen, [1, 1.5, 2, 1]);
});

test('double speed runs twice the ticks', () => {
  const { s } = session();
  s.start(0);
  s.cycleSpeed(0);
  s.cycleSpeed(0);
  s.frame(50);
  assert.equal(s.game.elapsedTicks, 6);
});

test('a hidden tab stops the run and it stays paused on return', () => {
  const { s, log } = session();
  s.start(0);
  s.frame(50);
  s.hide(60);
  const ticks = s.game.elapsedTicks;
  s.frame(2000);
  assert.equal(s.paused, true);
  assert.equal(s.game.elapsedTicks, ticks);
  assert.ok(log.includes('suspend'));
});

test('one frame advances at most eight ticks and never catches up', () => {
  const { s } = session();
  s.start(0);
  s.frame(1000);
  assert.equal(s.game.elapsedTicks, frameTickLimit);
  s.frame(1016);
  assert.ok(s.game.elapsedTicks <= frameTickLimit + 2);
});

test('START opens audio only when sound is on', () => {
  const on = session(true),
    off = session(false);
  on.s.start(0);
  off.s.start(0);
  assert.ok(on.log.includes('unlock'));
  assert.ok(!off.log.includes('unlock'));
});

test('the result is recorded once', () => {
  const { s, log } = session();
  s.start(0);
  for (let wall = 0; s.game.phase !== 'result' && wall < 600_000; wall += 100) s.frame(wall);
  s.frame(700_000);
  assert.equal(s.game.phase, 'result');
  assert.equal(log.filter((entry) => entry === 'record').length, 1);
});
