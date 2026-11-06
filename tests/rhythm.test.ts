import assert from 'node:assert/strict';
import test from 'node:test';
import { rules } from '../src/game/rules.ts';
import { fixture, session, target } from './helpers.ts';

const finishMass = rules.combat.resonance.finishMass;
// Three beats on three ticks; returns whether each was accepted.
function round(g: ReturnType<typeof fixture>) {
  return ([1, 2, 3] as const).map((beat) => {
    g.run(1);
    return g.resonate(beat);
  });
}

test('three beats shed finishMass, never below zero; a second tap in one tick is ignored', () => {
  const g = fixture({}, [target(1, 180, 400, 1e6)]);
  g.mass = 5;
  assert.deepEqual(round(g), [true, true, true]);
  assert.equal(g.mass, 5 - finishMass);
  g.mass = finishMass / 2;
  round(g);
  assert.equal(g.mass, 0);
  g.run(1);
  assert.equal(g.resonate(1), true);
  assert.equal(g.resonate(2), false, 'same tick');
  assert.equal(g.inputs.filter((i) => i.kind === 'beat').length, 7);
});

test('Tempo Coil does nothing without beats and sweeps the orbit on one', () => {
  // Particles on the orbit just ahead of the electron (top of the orbit).
  const crowd = [0, 1, 2].map((i) => target(i, 200 + i * 10, 130, 1e6));
  const g = fixture({ tempo: 5 }, crowd);
  g.run(600);
  assert.ok(
    crowd.every((t) => t.hp === 1e6),
    'tempo hit without a beat',
  );
  g.resonate(1);
  g.run(30);
  assert.ok(
    crowd.some((t) => t.hp < 1e6),
    'tempo missed its beat',
  );
  assert.ok(g.events.some((e) => e.kind === 'skill-effect' && e.data.id === 'tempo'));
});

test('a player tapping on the beat completes rounds through the session', () => {
  const { s, log } = session(false);
  s.start(0);
  let wall = 0;
  for (; wall < 40_000 && !s.rhythm.completed; wall += 1000 / 60) {
    s.frame(wall);
    const r = s.rhythm;
    if (s.game.choice) s.select(s.game.automaticCard!.id, s.game.choice.number, wall);
    else if (r.open && r.due <= r.age) s.tap(wall);
  }
  assert.ok(s.rhythm.completed >= 1, 'no round completed in 40 seconds');
  // A level-up between beats cancels the round; the next one starts again at 1.
  const beats = s.game.inputs.flatMap((i) => (i.kind === 'beat' ? [i.beat] : []));
  assert.deepEqual(beats.slice(-3), [1, 2, 3]);
  assert.ok(
    beats.every((b, i) => b === 1 || b === beats[i - 1] + 1),
    beats.join(),
  );
  assert.ok(log.includes('rhythm-complete'));
});
