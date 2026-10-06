import test from 'node:test';
import assert from 'node:assert/strict';
import { stationarySkill, target, close } from './helpers.ts';
import { rules, skillIds } from '../src/game/rules.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import { Game } from '../src/game/Game.ts';

test('the current roster replaces ball lightning and short circuit without aliases', () => {
  assert.equal(skillIds.length, 16);
  assert.ok(skillIds.includes('satellite') && skillIds.includes('vent'));
  assert.ok(!Object.hasOwn(rules.skills, 'orb') && !Object.hasOwn(rules.skills, 'stun'));
});

test('pursuit jumps only after its kill, uses a shared finite budget and ignores healthy foes', () => {
  const ts = Array.from({ length: 10 }, (_, id) => {
    const t = target(id, 190 + id * 6, 128, 100);
    t.hp = 1;
    return t;
  });
  const healthy = target(10, 195, 128, 100);
  const g = stationarySkill({ chase: 1 }, [...ts, healthy]);
  g.combat.fireSkill('chase');
  assert.equal(g.counts.quark.killed, 1);
  g.advance(110);
  assert.equal(g.counts.quark.killed, 2);
  g.advance(1000);
  assert.equal(g.counts.quark.killed, 1 + g.forms.chase.jumps);
  assert.equal(healthy.hp, 100);
  const h = stationarySkill(
    { chase: 5, multi: 3 },
    ts.map((t, i) => ({ ...t, hp: 1, id: i })),
  );
  h.combat.fireSkill('chase');
  h.advance(1000);
  assert.ok(
    h.counts.quark.killed <= h.forms.chase.count + h.forms.multi.count - 1 + h.forms.chase.jumps,
  );
});

test('a surviving pursuit target does not schedule bonus jumps', () => {
  const ts = [target(0, 190, 128, 1000), target(1, 215, 128, 1000)];
  ts.forEach((t) => (t.hp = 200));
  const g = stationarySkill({ chase: 1 }, ts);
  g.combat.fireSkill('chase');
  const hp = ts.map((t) => t.hp);
  g.advance(1000);
  assert.deepEqual(
    ts.map((t) => t.hp),
    hp,
  );
});

test('return sweeps all enemies along its route without requiring pierce or duplicate damage', () => {
  const initial = target(0, 190, 128, 1);
  const middle = target(1, 230, 171.27868852459017, 1000);
  const end = target(2, 270, 214.55737704918033, 1000);
  const g = stationarySkill({ return: 2 }, [initial, middle, end]);
  g.combat.fireBasic();
  g.angle = 0;
  g.advance(300);
  for (const t of [middle, end]) close(1000 - t.hp, g.damage * g.forms.return.damage);
  g.advance(1000);
  for (const t of [middle, end]) close(1000 - t.hp, g.damage * g.forms.return.damage);
});

test('sustained hits charge surge against a durable foe; active surge cannot replenish itself', () => {
  const p = target(0, 190, 128, 100000);
  const g = stationarySkill({ surge: 1 }, [p]);
  const hits = Math.ceil(g.forms.surge.kills / rules.skills.surge.hitCharge);
  for (let i = 0; i < hits && !g.combat.status('surge').active; i++) {
    g.combat.fireBasic();
    g.advance(200);
  }
  assert.equal(g.counts.quark.killed, 0);
  assert.ok(g.combat.status('surge').active);
  for (let i = 0; i < 100; i++) g.combat.fireBasic();
  g.advance(2000);
  assert.equal(g.combat.status('surge').active, false);
  assert.equal(g.combat.status('surge').progress, 0);
});

test('same-tick crowds cannot instantly fill surge from hundreds of nonlethal hits', () => {
  const ts = Array.from({ length: 100 }, (_, i) => target(i, 190 + i, 128, 10000));
  const g = stationarySkill({ surge: 1, pierce: 5, chain: 5 }, ts);
  g.combat.fireBasic();
  close(g.combat.status('surge').progress, rules.skills.surge.hitCharge / g.forms.surge.kills);
});

test('vent rarity improves recovery without adding damage, XP or negative mass', () => {
  const g = stationarySkill({ vent: 5 }, [target(0, 190, 128, 100)]);
  g.rarities.vent = 'legendary';
  g.mass = 100;
  const forms = g.forms;
  assert.equal(g.combat.fireSkill('vent'), true);
  assert.equal(g.mass, 100 - forms.vent.mass);
  assert.equal(g.targets[0].hp, 100);
  assert.equal(g.xp, 0);
  g.mass = 1;
  g.combat.fireSkill('vent');
  assert.equal(g.mass, 0);
  assert.equal(g.combat.fireSkill('vent'), false);
});

test('barrier occupancy never stacks slow and immediately releases enemies after leaving', () => {
  const p = target(0, 180, 140, 10000);
  const g = stationarySkill({ bridge: 5 }, [p]);
  for (let i = 0; i < 20; i++) g.combat.fireSkill('bridge');
  g.advance(20);
  close(10000 - p.hp, g.damage * g.forms.bridge.damage * g.forms.bridge.count);
  assert.equal(g.combat.movementScale(p), rules.skills.bridge.movementScale);
  Object.assign(p, target(0, 300, 260, p.hp));
  g.advance(100);
  assert.equal(g.combat.movementScale(p), 1);
  g.combat.clear();
  assert.equal(g.combat.status('bridge').active, false);
});

test('new skills survive a natural checkpoint and reproduce future combat and mass', () => {
  let checked = false;
  for (let seed = 92000; seed < 92050 && !checked; seed++) {
    const g = new Game(seed);
    g.start();
    while (g.phase === 'running' && g.time < 180) {
      g.advance(1000 / rules.tickRate);
      const card = g.choice?.cards.find((c) => c.id === 'satellite' || c.id === 'vent');
      if (card) g.select(card.id);
      if (!g.ranks.vent && !g.ranks.satellite) continue;
      g.advance(500);
      const checkpoint = createCheckpoint(g);
      if (!checkpoint) break;
      const restored = restoreCheckpoint(checkpoint);
      assert.ok(restored);
      g.advance(10000);
      restored.advance(10000);
      assert.equal(restored.mass, g.mass);
      assert.deepEqual(restored.events, g.events);
      assert.deepEqual(restored.combat.satellitePoints, g.combat.satellitePoints);
      checked = true;
      break;
    }
  }
  assert.ok(checked);
});
