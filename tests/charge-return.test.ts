import test from 'node:test';
import assert from 'node:assert/strict';
import { stationarySkill, target, close } from './helpers.ts';
import { blankRanks, blankRarities, rules } from '../src/game/rules.ts';
import { skillValues } from '../src/game/skills.ts';

test('charge carries lethal hits between enemies and its discharge cannot recharge itself', () => {
  // One hit per charge: the hit that completes the charge discharges.
  const hits = Math.ceil(rules.skills.charge.threshold[1]);
  const fragile = Array.from({ length: hits }, (_, id) => target(id, 190 + id * 8, 128, 1));
  const heavy = target(hits, 190 + hits * 8, 128, 1000);
  const g = stationarySkill({ charge: 1 }, [...fragile, heavy]);
  for (let i = 0; i < hits - 1; i++) g.combat.fireBasic();
  close(g.combat.status('charge').progress, (hits - 1) / g.forms.charge.threshold);
  assert.equal(g.combat.activations.charge, undefined);
  g.combat.fireBasic();
  assert.ok(g.combat.activations.charge !== undefined);
  close(heavy.hp, 1000 - g.damage * g.forms.charge.damage);
  assert.equal(g.combat.status('charge').progress, 0);
  assert.equal(g.counts.quark.killed, hits);
});

test('a full capacitor waits for an actual recipient and clears with combat state', () => {
  const hits = Math.ceil(rules.skills.charge.threshold[1]);
  const g = stationarySkill(
    { charge: 1 },
    Array.from({ length: hits }, (_, id) => target(id, 190, 128, 1)),
  );
  for (let i = 0; i < hits; i++) g.combat.fireBasic();
  assert.equal(g.combat.status('charge').progress, 1);
  assert.equal(g.combat.activations.charge, undefined);
  assert.equal(g.combat.fireBasic(), false);
  assert.equal(g.combat.status('charge').progress, 1);
  g.targets.push(target(hits, 190, 128, 1000));
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
  const hp = g.damage * (1 + g.forms.return.damage / 2);
  p.hp = p.maxHp = hp;
  g.combat.fireBasic();
  close(p.hp, hp - g.damage);
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

test('rank and rarity strengthen the new skills, return width and charge', () => {
  const ids = ['spark', 'field', 'fission', 'overcharge', 'return', 'charge'] as const;
  const forms = (rank: number, legendary = false) =>
    skillValues(
      { ...blankRanks(), ...Object.fromEntries(ids.map((id) => [id, rank])) },
      {
        ...blankRarities(),
        ...Object.fromEntries(ids.map((id) => [id, legendary ? 'legendary' : 'common'])),
      },
      rules,
    );
  const first = forms(1),
    last = forms(5),
    rare = forms(5, true);
  for (const id of ['spark', 'field', 'fission', 'overcharge'] as const)
    assert.ok(first[id].damage < last[id].damage && last[id].damage < rare[id].damage, id);
  assert.ok(first.spark.count < last.spark.count);
  assert.ok(first.field.radius < last.field.radius && last.field.radius < rare.field.radius);
  assert.ok(first.fission.depth < last.fission.depth);
  assert.ok(first.overcharge.kills > last.overcharge.kills);
  assert.ok(first.return.width < last.return.width && last.return.width < rare.return.width);
  assert.ok(rare.charge.threshold < last.charge.threshold);
});
