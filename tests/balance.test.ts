import test from 'node:test';
import assert from 'node:assert/strict';
import { stationarySkill, target, close } from './helpers.ts';
import { blankRanks, blankRarities, rules } from '../src/game/rules.ts';
import { skillValues } from '../src/game/skills.ts';

test('charge carries lethal hits between enemies and its discharge cannot recharge itself', () => {
  const fragile = [0, 1, 2, 3].map((id) => target(id, 190 + id * 10, 128, 1));
  const heavy = target(4, 230, 128, 1000);
  const g = stationarySkill({ charge: 1 }, [...fragile, heavy]);
  for (let i = 0; i < 3; i++) g.combat.fireBasic();
  close(g.combat.status('charge').progress, 3 / g.forms.charge.threshold);
  assert.equal(g.combat.activations.charge, undefined);
  g.combat.fireBasic();
  assert.ok(g.combat.activations.charge !== undefined);
  close(heavy.hp, 1000 - g.damage * g.forms.charge.damage);
  assert.equal(g.combat.status('charge').progress, 0);
  assert.equal(g.counts.quark.killed, 4);
});

test('a full capacitor waits for an actual recipient and clears with combat state', () => {
  const g = stationarySkill(
    { charge: 1 },
    [0, 1, 2, 3].map((id) => target(id, 190, 128, 1)),
  );
  for (let i = 0; i < 4; i++) g.combat.fireBasic();
  assert.equal(g.combat.status('charge').progress, 1);
  assert.equal(g.combat.activations.charge, undefined);
  assert.equal(g.combat.fireBasic(), false);
  assert.equal(g.combat.status('charge').progress, 1);
  g.targets.push(target(4, 190, 128, 1000));
  g.counts.quark.generated++;
  g.combat.fireBasic();
  assert.ok(g.combat.activations.charge !== undefined);
  assert.equal(g.combat.status('charge').progress, 0);
  g.combat.fireBasic();
  assert.ok(g.combat.status('charge').progress > 0);
  g.combat.clear();
  assert.equal(g.combat.status('charge').progress, 0);
});

test('return hits a stationary primary once without scheduling another return', () => {
  const p = target(0, 190, 128, 20);
  const g = stationarySkill({ return: 3 }, [p]);
  g.boosts.power = 1;
  g.combat.fireBasic();
  assert.equal(p.hp, 7);
  g.advance(300);
  assert.equal(p.hp, 0);
  assert.equal(g.counts.quark.killed, 1);
  g.advance(1000);
  assert.equal(
    g.events.filter((e) => e.kind === 'skill-effect' && (e.data as { id: string }).id === 'return')
      .length,
    1,
  );
});

test('gather damages gathered survivors without pulling them toward the core', () => {
  const ts = [target(0, 200, 128, 1000), target(1, 235, 140, 1000), target(2, 165, 143, 1000)];
  const g = stationarySkill({ gather: 3 }, ts),
    radii = ts.map((t) => t.radius);
  g.combat.fireSkill('gather');
  assert.ok(ts.every((t) => t.hp < 1000));
  ts.forEach((t, i) => assert.ok(t.radius >= radii[i] - 1e-8));
});

test('rank and rarity strengthen gather, orbital coverage, return width and charge', () => {
  const forms = (rank: number, legendary = false) =>
    skillValues(
      { ...blankRanks(), gather: rank, bridge: rank, return: rank, charge: rank },
      {
        ...blankRarities(),
        gather: legendary ? 'legendary' : 'common',
        bridge: legendary ? 'legendary' : 'common',
        return: legendary ? 'legendary' : 'common',
        charge: legendary ? 'legendary' : 'common',
      },
      rules,
    );
  const first = forms(1),
    last = forms(5),
    rare = forms(5, true);
  assert.ok(first.gather.damage < last.gather.damage && last.gather.damage < rare.gather.damage);
  assert.ok(first.bridge.angle < last.bridge.angle && last.bridge.angle < rare.bridge.angle);
  assert.ok(first.return.width < last.return.width && last.return.width < rare.return.width);
  assert.ok(rare.charge.threshold < last.charge.threshold);
});
