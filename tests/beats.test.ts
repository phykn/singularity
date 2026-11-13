import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { rules } from '../src/game/rules.ts';
import { fired, fixture, session, target } from './helpers.ts';

const finishMass = rules.combat.resonance.finishMass,
  missMass = rules.pacts.pulse.missMass;
// Three beats on three ticks, each accepted.
function round(g: Game): void {
  for (const beat of [1, 2, 3] as const) {
    g.run(1);
    assert.equal(g.resonate(beat), true);
  }
}

test('three beats shed finishMass, never below zero; a second tap in one tick is ignored', () => {
  const g = fixture({}, [target(1, 180, 400, 1e6)]);
  g.mass = 5;
  round(g);
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
  // Particles on the orbit just ahead of the electron.
  const crowd = [0, 1, 2].map((i) => target(i, 200 + i * 10, 130, 1e6)),
    g = fixture({ tempo: 5 }, crowd);
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
  assert.ok(fired(g, 'tempo'));
});

test('with Overclock, three beats shed no mass and mass release is closed', () => {
  const g = fixture({}, [target(1, 180, 420, 1e6)]),
    mass = rules.growth.recovery.minMass + 10;
  g.mass = mass;
  assert.equal(g.growth.recoverable, true);
  round(g);
  assert.equal(g.mass, mass - finishMass);
  g.growth.pacts.overclock = true;
  assert.equal(g.growth.recoverable, false);
  round(g);
  assert.equal(g.mass, mass - finishMass);
});

test('a missed beat costs missMass only under Pulse and is recorded', () => {
  const g = fixture();
  g.mass = 5;
  g.run(1);
  assert.equal(g.resonate(0), true);
  assert.equal(g.mass, 5);
  g.growth.pacts.pulse = true;
  g.run(1);
  assert.equal(g.resonate(0), true);
  assert.equal(g.mass, 5 + missMass);
  assert.deepEqual(g.inputs.at(-1), { tick: g.elapsedTicks, kind: 'beat', beat: 0 });
});

test('a player tapping on the beat completes rounds through the session', () => {
  const { s, log } = session(false);
  s.start(0);
  for (let wall = 0; wall < 40_000 && !s.rhythm.completed; wall += 1000 / 60) {
    s.frame(wall);
    const r = s.rhythm,
      choice = s.game.growth.choice;
    if (choice) s.select(s.game.growth.automaticCard!.id, choice.number, wall);
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

test('under Pulse the session turns a wrong tap and a passed gate into missed beats', () => {
  const { s } = session(false);
  // Without combat no card offer interrupts the rhythm.
  s.replace(new Game(7, { combat: false }), 0);
  s.start(0);
  s.game.growth.pacts.pulse = true;
  let wall = 0;
  const step = () => s.frame((wall += 1000 / 60)),
    missed = () => s.game.inputs.filter((i) => i.kind === 'beat' && i.beat === 0).length;
  while (!(s.rhythm.active && !s.rhythm.open)) step();
  const mass = s.game.mass;
  s.tap(wall);
  assert.equal(missed(), 1, 'a tap off the gate');
  assert.equal(s.game.mass, mass + missMass);
  // Hit the first beat of the next round, then let the second gate pass.
  while (!(s.rhythm.open && s.rhythm.due <= s.rhythm.age)) step();
  s.tap(wall);
  assert.equal(s.rhythm.hits, 1);
  while (s.rhythm.active) step();
  for (let i = 0; i < 10; i++) step();
  assert.equal(missed(), 2, 'a gate passed after the first hit');
});
