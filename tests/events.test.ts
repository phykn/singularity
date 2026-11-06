import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { rules } from '../src/game/rules.ts';

const tickRate = rules.time.tickRate;
// Spawning off; the clock jumps to just before `seconds` and runs one tick.
function at(g: Game, seconds: number): void {
  g.tick = Math.round(seconds * tickRate) - 1;
  g.run(1);
}
const fresh = () => {
  const g = new Game(7, { combat: false });
  g.start();
  return g;
};
const logged = (g: Game, kind: string) => g.events.filter((e) => e.kind === kind);

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
  assert.ok(g.targets.some((t) => t.final && t.boss === 'higgs'));
  assert.equal(logged(g, 'charged').length, 1);
  assert.equal(g.xp, 0);
});

test('a boss comes while the last one lives; the round waits for the earlier boss', () => {
  const g = fresh();
  at(g, rules.bosses[0].time);
  at(g, rules.bosses[1].time);
  const [gluon, w] = ['gluon', 'w'].map((kind) => g.targets.find((t) => t.boss === kind)!);
  assert.ok(gluon && w, 'both giants on the field');
  g.damageTarget(w, 1e12);
  assert.equal(g.round, 1, 'the W fell first, but the gluon still holds round 1');
  g.damageTarget(gluon, 1e12);
  assert.equal(g.round, 3);
  assert.deepEqual(
    logged(g, 'round').map((e) => e.data.round),
    [2, 3],
  );
});

test('the Higgs decides the run: popped is a win, reaching the core is a loss', () => {
  const won = fresh();
  won.bossCount = rules.bosses.length;
  at(won, rules.higgs.time);
  won.damageTarget(
    won.targets.find((t) => t.final)!,
    1e12,
  );
  won.run(600);
  assert.equal(won.result?.outcome, 'success');
  assert.equal(won.result?.trigger, 'boss');

  const lost = fresh();
  lost.bossCount = rules.bosses.length;
  at(lost, rules.higgs.time);
  lost.run(200 * tickRate);
  assert.equal(lost.result?.outcome, 'collapse-failure');
  assert.equal(lost.result?.trigger, 'boss-absorbed');
});

test('two fallen giants open the fifth slot', () => {
  const g = fresh();
  assert.equal(g.skillSlots, rules.growth.skillSlots);
  for (const boss of rules.bosses.slice(0, 2)) {
    at(g, boss.time);
    g.damageTarget(
      g.targets.find((t) => t.boss === boss.kind)!,
      1e12,
    );
  }
  assert.equal(g.skillSlots, rules.growth.skillSlots + 1);
  assert.equal(g.banner?.kind, 'slot-open');
});
