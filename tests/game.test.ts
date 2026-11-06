import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { CENTER } from '../src/game/geometry.ts';
import { replay } from '../src/game/replay.ts';
import { finish, fixture, target } from './helpers.ts';

test('a seeded run to its loss logs the same events twice and again from its record', () => {
  const first = finish(new Game(1)),
    second = finish(new Game(1));
  assert.equal(first.result?.outcome, 'collapse-failure');
  assert.deepEqual(second.events, first.events);
  const replayed = replay(first.record);
  assert.ok(replayed);
  assert.deepEqual(replayed.events, first.events);
  assert.deepEqual(replayed.result, first.result);
});

test('a clear continued beyond and quit replays to the same endless result', () => {
  const g = finish(new Game(5)); // seed 5 clears on automatic picks
  assert.equal(g.result?.outcome, 'success');
  assert.equal(g.continueBeyond(), true);
  g.run(30 * g.rules.time.tickRate);
  assert.equal(g.retire(), true);
  const replayed = replay(g.record);
  assert.ok(replayed);
  assert.deepEqual(replayed.result, g.result);
  assert.deepEqual(replayed.clearResult, g.clearResult);
});

test('a record made under other rules does not replay', () => {
  const g = finish(new Game(1));
  assert.equal(replay({ ...g.record, rules: 'other' }), null);
});

test('a particle reaching the core adds its mass and pulls the orbit in', () => {
  const g = fixture({}, [target(1, CENTER.x + 12, CENTER.y, 2, 'proton')]);
  const radius = g.radius;
  g.run(1);
  assert.equal(g.mass, g.rules.particles.proton.mass);
  assert.equal(g.targets.length, 0);
  g.run(60);
  assert.ok(g.radius < radius);
});

test('the electron reaching the core collapses the run into a result', () => {
  const g = fixture();
  g.mass = 1000;
  const phases = new Set<string>();
  while (g.phase !== 'result' && g.elapsedTicks < 60 * 120) {
    g.run(1);
    phases.add(g.phase);
  }
  assert.deepEqual([...phases], ['running', 'collapse', 'ending', 'result']);
  assert.equal(g.result?.outcome, 'collapse-failure');
  assert.ok(g.margin <= 0);
});

test('stage values climb toward the next stage and stage starts follow time', () => {
  const g = fixture();
  const stages = g.rules.stages;
  assert.equal(g.stage, 0);
  assert.equal(
    g.staged((s) => s.hp.small),
    stages[0].hp.small,
  );
  g.tick = ((stages[0].start + stages[1].start) / 2) * g.rules.time.tickRate;
  const middle = g.staged((s) => s.hp.small);
  assert.ok(middle > stages[0].hp.small && middle < stages[1].hp.small);
  g.tick = stages[1].start * g.rules.time.tickRate;
  assert.equal(g.stage, 1);
});

test('basic fire kills the nearest particle in range and grants its XP', () => {
  const near = target(1, 0, 0),
    far = target(2, 0, 0);
  const g = fixture({}, [near, far]);
  Object.assign(near, { x: g.position.x + 10, y: g.position.y });
  Object.assign(far, { x: g.position.x + 60, y: g.position.y });
  g.combat.fireBasic();
  assert.deepEqual(g.targets, [far]);
  assert.equal(g.xp, 1);
  assert.ok(g.events.some((e) => e.kind === 'kill' && e.data.id === 1));
});
