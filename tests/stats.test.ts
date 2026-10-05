import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/model.ts';
import { rules, recoveryMass, rangeScale, skillIds } from '../src/game/rules.ts';
import { choose, close, fixture, stationarySkill, target } from './helpers.ts';

test('field reach acquires distant targets without changing damage, speed or splash geometry', () => {
  const g = fixture({ area: 1, burst: 1, wave: 1 }, [target(0, 280, 128)]);
  const before = { forms: g.forms, damage: g.damage, speed: g.speed, radius: g.targetRadius };
  g.combat.fireBasic();
  assert.equal(g.xp, 0);
  choose(g, 'range');
  g.combat.fireBasic();
  assert.equal(g.xp, 1);
  assert.equal(g.damage, before.damage);
  assert.equal(g.speed, before.speed);
  assert.equal(g.targetRadius, before.radius);
  assert.deepEqual(g.forms.area, before.forms.area);
  assert.deepEqual(g.forms.burst, before.forms.burst);
  assert.deepEqual(g.forms.wave, before.forms.wave);
  assert.equal(g.forms.strike.radius, before.forms.strike.radius);
  assert.equal(g.forms.pierce.width, before.forms.pierce.width);
});

test('range grows at diminishing returns and remains useful above skill rank limits', () => {
  const values = [0, 1, 5, 20, 100, 1000].map((rank) => rangeScale(rank, 'common'));
  for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1]);
  assert.ok(values.at(-1)! < 1 + rules.rangeBonus);
  assert.ok(rangeScale(1, 'legendary') > rangeScale(1, 'common'));
});

test('repeat retargets at the cast reach and an upgrade does not rewrite reserved geometry', () => {
  for (const upgradedBeforeCast of [false, true]) {
    const g = stationarySkill({ repeat: 1 }, [target(0, 190, 128), target(1, 280, 128)]);
    if (upgradedBeforeCast) choose(g, 'range');
    g.combat.fireBasic();
    if (!upgradedBeforeCast) choose(g, 'range');
    g.advance(rules.skills.repeat.delaySeconds * 1000);
    assert.equal(g.xp, upgradedBeforeCast ? 2 : 1);
  }
});

test('reach extends chain jumps, piercing beams and lashes while keeping widths and angles', () => {
  for (const id of ['chain', 'pierce', 'whip'] as const) {
    const x = id === 'chain' ? 241 : id === 'pierce' ? 339 : 253;
    const g = stationarySkill({ [id]: 1 }, [target(0, 190, 128, 100), target(1, x, 128, 100)]);
    const before = g.forms;
    choose(g, 'range');
    choose(g, 'range');
    if (id === 'whip') {
      g.combat.fireSkill(id);
      g.advance(400);
    } else g.combat.fireBasic();
    assert.ok(g.targets[1].hp < 100, id + ' must reach the distant target');
    assert.equal(g.forms.whip.arc, before.whip.arc);
    assert.equal(g.forms.pierce.width, before.pierce.width);
  }
});

test('strike and focus acquire farther targets; focus slow uses the same extended range', () => {
  for (const id of ['strike', 'focus'] as const) {
    const offset = id === 'strike' ? 170 : 100;
    const t = target(0, 180 + offset, 128, 100);
    const g = stationarySkill({ [id]: 1 }, [t]);
    g.combat.fireSkill(id);
    g.advance(50);
    assert.equal(t.hp, 100);
    g.combat.clear();
    choose(g, 'range');
    g.combat.fireSkill(id);
    g.advance(50);
    assert.ok(t.hp < 100);
    if (id === 'focus') {
      assert.ok(g.combat.movementScale(t) < 1);
      t.x = g.position.x + g.forms.focus.range + 1;
      assert.equal(g.combat.movementScale(t), 1);
    }
  }
});

test('mass vent is instant, consumes a choice, preserves XP and stats, and never becomes passive healing', () => {
  const g = fixture({ area: 2 });
  g.xp = 100;
  g.mass = 120;
  g.radius = g.targetRadius;
  const before = structuredClone({ ranks: g.ranks, boosts: g.boosts, xp: g.xp, radius: g.radius });
  choose(g, 'recover', 'rare');
  assert.equal(g.mass, 120 - recoveryMass('rare'));
  assert.equal(g.xp, before.xp);
  assert.deepEqual(g.ranks, before.ranks);
  assert.deepEqual(g.boosts, before.boosts);
  assert.equal(g.rank('recover'), 0);
  assert.equal(g.selections.at(-1)?.id, 'recover');
  g.advance(10000);
  assert.ok(g.radius > before.radius);
  assert.equal(g.mass, 120 - recoveryMass('rare'));
});

test('recovery clamps at zero and its rarity applies only to this use', () => {
  const g = fixture();
  g.mass = rules.recovery.minMass;
  choose(g, 'recover', 'legendary');
  assert.equal(g.mass, 0);
  assert.equal(g.recoverable, false);
  g.mass = 150;
  choose(g, 'recover', 'common');
  assert.equal(g.mass, 150 - recoveryMass('common'));
  assert.equal(g.rarities.recover, 'common');
});

test('recovery is absent in safe orbits and remains available alongside maxed skills in danger', () => {
  for (let seed = 0; seed < 64; seed++) {
    const g = new Game(seed, { combat: false });
    g.start();
    g.debugSetXp(85);
    g.select(g.choice!.cards[0].id);
    assert.ok(g.choice!.cards.every((c) => c.id !== 'recover'));
    g.choice = null;
    g.mass = 140;
    g.radius = g.targetRadius;
    g.ranks = { ...g.ranks, area: 5, chain: 5, multi: 5, repeat: 5 };
    g.debugSetXp(210);
    assert.equal(g.choice!.cards[0].id, 'recover');
    assert.equal(g.choice!.cards.length, 3);
    assert.equal(new Set(g.choice!.cards.map((c) => c.id)).size, 3);
  }
});

test('global cooldown reduction retains progress for every timed skill', () => {
  const g = stationarySkill({}, [target(0, 190, 128, 100000)]);
  for (const id of ['strike', 'wave', 'whip', 'focus'] as const) choose(g, id);
  g.advance(250);
  const before = skillIds.map((id) => g.combat.status(id).progress);
  const oldInterval = g.attackInterval;
  choose(g, 'rate');
  skillIds.forEach((id, i) => close(g.combat.status(id).progress, before[i]));
  assert.ok(g.attackInterval < oldInterval);
});

test('replay restores manual range and recovery selections with the same future', () => {
  let found = false;
  for (let seed = 2000; seed < 2020 && !found; seed++) {
    const g = new Game(seed);
    g.start();
    while (g.phase === 'running' && g.time < 240) {
      g.advance(1000 / rules.tickRate);
      const card =
        g.choice?.cards.find((c) => c.id === 'recover') ??
        g.choice?.cards.find((c) => c.id === 'range');
      if (card) g.select(card.id);
      if (!['recover', 'range'].every((id) => g.selections.some((s) => s.id === id))) continue;
      const restored = Game.restore(g.checkpoint()!)!;
      assert.ok(restored);
      assert.deepEqual(restored.boosts, g.boosts);
      assert.equal(restored.mass, g.mass);
      assert.deepEqual(restored.events, g.events);
      g.advance(1800000);
      restored.advance(1800000);
      assert.deepEqual(restored.result, g.result);
      found = true;
      break;
    }
  }
  assert.ok(found, 'A natural replay must include both new selections');
});
