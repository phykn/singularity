import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { rules } from '../src/game/rules.ts';
import type { BossKind } from '../src/game/rules.ts';
import { logged, tickRate } from './helpers.ts';

// Spawning off; the clock jumps to just before `seconds` and runs one tick.
function at(g: Game, seconds: number): void {
  g.tick = Math.round(seconds * tickRate) - 1;
  g.run(1);
}
function fresh(): Game {
  const g = new Game(7, { combat: false });
  g.start();
  return g;
}
const giant = (g: Game, kind: BossKind) => g.targets.find((t) => t.boss === kind)!;
// A run at the Higgs particle's arrival, the five giants skipped.
function atHiggs(): Game {
  const g = fresh();
  g.giants.count = rules.bosses.length;
  at(g, rules.higgs.time);
  return g;
}

test('giants, the critical breach and the Higgs arrive by the clock, not by XP', () => {
  const g = fresh();
  rules.bosses.forEach((boss, i) => {
    at(g, boss.time - 1 / tickRate);
    assert.equal(logged(g, 'boss').length, i, `${boss.kind} came early`);
    at(g, boss.time);
    assert.equal(logged(g, 'boss')[i].data.boss, boss.kind);
  });
  at(g, rules.critical.time - 1 / tickRate);
  assert.equal(g.critical, false);
  at(g, rules.critical.time);
  assert.equal(logged(g, 'critical').length, 1);
  at(g, rules.higgs.time);
  assert.equal(giant(g, 'higgs').final, true);
  assert.equal(logged(g, 'charged').length, 1);
  assert.equal(g.growth.xp, 0);
});

test('a boss comes while the last one lives; the round waits for the earlier boss', () => {
  const g = fresh();
  at(g, rules.bosses[0].time);
  at(g, rules.bosses[1].time);
  g.damageTarget(giant(g, 'w'), 1e12);
  assert.equal(g.giants.round, 1, 'the W fell first, but the gluon still holds round 1');
  g.damageTarget(giant(g, 'gluon'), 1e12);
  assert.deepEqual(
    logged(g, 'round').map((e) => e.data.round),
    [2, 3],
  );
});

test('the Higgs decides the run: popped is a win, reaching the core is a loss', () => {
  const won = atHiggs();
  won.damageTarget(giant(won, 'higgs'), 1e12);
  won.run(600);
  assert.equal(won.result?.outcome, 'success');
  assert.equal(won.result?.trigger, 'boss');
  const lost = atHiggs();
  lost.run(200 * tickRate);
  assert.equal(lost.result?.outcome, 'collapse-failure');
  assert.equal(lost.result?.trigger, 'boss-absorbed');
});

test('two fallen giants open the fifth slot', () => {
  const g = fresh();
  assert.equal(g.growth.skillSlots, rules.growth.skillSlots);
  for (const boss of rules.bosses.slice(0, 2)) {
    at(g, boss.time);
    g.damageTarget(giant(g, boss.kind), 1e12);
  }
  assert.equal(g.growth.skillSlots, rules.growth.skillSlots + 1);
  assert.equal(g.banner?.kind, 'slot-open');
});

// A cleared run continued beyond the singularity.
function beyond(): Game {
  const g = atHiggs();
  g.damageTarget(giant(g, 'higgs'), 1e12);
  g.run(600);
  assert.equal(g.continueBeyond(), true);
  g.run(Math.ceil(rules.time.beyondSeconds * tickRate) + 1);
  assert.equal(g.phase, 'running');
  return g;
}

test('endless mode opens round seven; a giant comes each round, one step harder each', () => {
  const g = beyond(),
    e = rules.endless,
    kinds = [];
  assert.equal(g.giants.round, rules.bosses.length + 2);
  assert.equal(g.critical, false, 'no critical breach beyond');
  for (let round = 0; round < rules.bosses.length + 1; round++) {
    g.mass = 0; // giants feed the core; keep the orbit open for six rounds
    g.run(Math.round(e.roundSeconds * tickRate) - 2);
    assert.equal(g.giants.boss, undefined, `round ${g.giants.round}: giant came early`);
    g.run(2);
    const boss = g.giants.boss!;
    assert.ok(boss, `round ${g.giants.round}: no giant after ${e.roundSeconds}s`);
    kinds.push(boss.boss);
    g.run(5 * tickRate);
    assert.equal(g.targets.filter((t) => t.boss).length, 1, 'one giant per round');
    const strength = g.enemyStrength.hp;
    // The Z boson shrugs off hits while it is immune.
    for (let i = 0; i < 20 * tickRate && g.targets.includes(boss); i++) {
      g.damageTarget(boss, 1e12);
      g.run(1);
    }
    assert.equal(g.giants.round, rules.bosses.length + 3 + round);
    assert.ok(
      Math.abs(g.enemyStrength.hp / strength - e.roundHpMultiplier) < 1e-9,
      'hp steps up only when the round ends',
    );
  }
  assert.deepEqual(kinds, [...rules.bosses.map((b) => b.kind), rules.bosses[0].kind]);
  assert.equal(
    g.targets.some((t) => t.final),
    false,
    'the Higgs does not return',
  );
});

test('quitting an endless run keeps the clear and reports the time beyond', () => {
  const g = beyond();
  g.run(10 * tickRate);
  assert.equal(g.retire(), true);
  assert.equal(g.result?.outcome, 'retired');
  assert.equal(g.result?.trigger, 'quit');
  assert.ok(Math.abs(g.result!.endless!.seconds - 10) < 0.1);
  assert.equal(g.clearResult?.outcome, 'success');
  assert.equal(fresh().retire(), false, 'a normal run cannot retire');
});
