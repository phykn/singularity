import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { CENTER } from '../src/game/geometry.ts';
import { replay } from '../src/game/replay.ts';
import { rules } from '../src/game/rules.ts';
import { finish, fixture, logged, session, target, tickRate } from './helpers.ts';

test('a seeded run to its loss logs the same events twice and again from its record', () => {
  const first = finish(new Game(1)),
    second = finish(new Game(1));
  assert.equal(first.result?.outcome, 'collapse-failure');
  assert.deepEqual(second.events, first.events);
  const replayed = replay(first.record);
  assert.ok(replayed);
  assert.deepEqual(replayed.events, first.events);
  assert.deepEqual(replayed.result, first.result);
  assert.equal(replay({ ...first.record, rules: 'other' }), null, 'a record under other rules');
});

test('a clear continued beyond and quit replays to the same endless result', () => {
  const g = finish(new Game(5)); // seed 5 clears on automatic picks
  assert.equal(g.result?.outcome, 'success');
  assert.equal(g.continueBeyond(), true);
  g.run(30 * tickRate);
  assert.equal(g.retire(), true);
  const replayed = replay(g.record);
  assert.ok(replayed);
  assert.deepEqual(replayed.result, g.result);
  assert.deepEqual(replayed.clearResult, g.clearResult);
});

test('a run played through the session with beats replays from its record', () => {
  const { s } = session(false);
  s.start(0);
  for (let wall = 0; wall < 90_000; wall += 1000 / 60) {
    s.frame(wall);
    const r = s.rhythm,
      choice = s.game.growth.choice;
    if (choice) s.select(s.game.growth.automaticCard!.id, choice.number, wall);
    else if (r.open && r.due <= r.age) s.tap(wall);
  }
  assert.ok(s.game.inputs.some((input) => input.kind === 'beat'));
  assert.deepEqual(replay(s.game.record)?.events, s.game.events);
});

test('a particle reaching the core adds its mass and pulls the orbit in', () => {
  const g = fixture({}, [target(1, CENTER.x + 12, CENTER.y, 2, 'proton')]),
    radius = g.radius;
  g.run(1);
  assert.equal(g.mass, rules.particles.proton.mass);
  assert.equal(g.targets.length, 0);
  g.run(60);
  assert.ok(g.radius < radius);
});

test('the electron reaching the core collapses the run into a result', () => {
  const g = fixture();
  g.mass = 1000;
  const phases = new Set<string>();
  while (g.phase !== 'result' && g.elapsedTicks < 120 * tickRate) {
    g.run(1);
    phases.add(g.phase);
  }
  assert.deepEqual([...phases], ['running', 'collapse', 'ending', 'result']);
  assert.equal(g.result?.outcome, 'collapse-failure');
  assert.ok(g.margin <= 0);
});

test('stage values climb toward the next stage and stage starts follow time', () => {
  const g = fixture(),
    stages = rules.stages,
    hp = () => g.spawner.staged((s) => s.hp.small);
  assert.equal(g.spawner.stage, 0);
  assert.equal(hp(), stages[0].hp.small);
  g.tick = ((stages[0].start + stages[1].start) / 2) * tickRate;
  assert.ok(hp() > stages[0].hp.small && hp() < stages[1].hp.small);
  g.tick = stages[1].start * tickRate;
  assert.equal(g.spawner.stage, 1);
});

test('five kills in one tick pop in turn as taps and all at once as a burst', () => {
  const row = (hp: number, y: number) => [0, 1, 2, 3, 4].map((i) => target(i, 180 + i * 4, y, hp)),
    delays = (g: Game) => g.effects.filter((fx) => fx.kind === 'kill').map((fx) => fx.delay!);
  const tap = fixture({}, row(2, 140)),
    pops = rules.combat.pops.tap;
  for (const t of [...tap.targets]) tap.damageTarget(t, 99, false, 'tap');
  assert.deepEqual(
    delays(tap).map((d) => +d.toFixed(3)),
    [0, 1, 2, 3, 4].map((i) => +Math.min(pops.max, i * pops.stagger).toFixed(3)),
  );
  assert.equal(logged(tap, 'kill').length, 5);
  const fork = fixture({ multi: 4 }, row(1, 160));
  fork.combat.fireBasic();
  assert.deepEqual(delays(fork), [0, 0, 0, 0, 0]);
});
