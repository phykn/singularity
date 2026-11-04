import test from 'node:test';
import assert from 'node:assert/strict';
import { stationarySkill, target, close, choose } from './helpers.ts';
import { rules, skillIds } from '../src/game/rules.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import { Game } from '../src/game/Game.ts';

test('the roster has sixteen skills and no removed ones', () => {
  assert.equal(skillIds.length, 16);
  for (const id of ['spark', 'field', 'fission', 'overcharge'])
    assert.ok(skillIds.includes(id as never), id);
  for (const id of ['focus', 'repel', 'gather', 'chase', 'bridge', 'vent', 'orb', 'stun'])
    assert.ok(!Object.hasOwn(rules.skills, id), id);
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

test('spark scatters one pop per direction and pops each target once', () => {
  const g = stationarySkill({ spark: 1 }, []);
  const { x, y } = g.position;
  const ring = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    return target(i, x + Math.cos(angle) * 40, y + Math.sin(angle) * 40, 1);
  });
  g.targets = [...ring];
  g.counts.quark.generated = ring.length;
  assert.equal(g.combat.fireSkill('spark'), true);
  g.advance(1000);
  assert.equal(g.counts.quark.killed, g.forms.spark.count);
  // The sparks spread out instead of landing on one side.
  const killed = ring.filter((t) => t.hp <= 0 || !g.targets.includes(t));
  const sides = new Set(killed.map((t) => Math.sign(Math.round(t.x - x))));
  assert.ok(sides.size >= 2);
});

test('static field pops weak particles together and takes a share of a giant particle', () => {
  const g = stationarySkill({ field: 1 }, []);
  const { x, y } = g.position;
  const weak = [target(0, x + 10, y, 1), target(1, x - 12, y + 5, 1)];
  const boss = target(2, x + 20, y - 10, 1000);
  boss.kind = 'boss';
  const far = target(3, x + 400, y, 1);
  g.targets = [...weak, boss, far];
  g.counts.quark.generated = 3;
  assert.equal(g.combat.fireSkill('field'), true);
  assert.equal(g.counts.quark.killed, 2);
  close(1000 - boss.hp, 1000 * g.forms.field.bossFraction);
  assert.equal(far.hp, 1);
});

test('fission splits each kill into its nearest neighbours up to its depth', () => {
  const g = stationarySkill({ fission: 1 }, []);
  const { x, y } = g.position;
  const line = Array.from({ length: 12 }, (_, i) => target(i, x + 20 + i * 18, y, 1));
  g.targets = [...line];
  g.counts.quark.generated = line.length;
  g.combat.fireBasic(line[0]);
  g.advance(1500);
  const killed = g.counts.quark.killed;
  assert.ok(killed > 1, 'A kill must take neighbours with it');
  assert.ok(killed < line.length, 'Depth limits the domino');
  assert.ok(g.combat.activations.fission !== undefined);
});

test('overcharge discharges the orbit only after enough kills', () => {
  const g = stationarySkill({ overcharge: 1 }, []);
  const prey = Array.from({ length: g.forms.overcharge.kills - 1 }, (_, i) =>
    target(i, g.position.x + 4, g.position.y, 1),
  );
  for (const t of prey) g.combat.killed(t);
  assert.equal(g.combat.activations.overcharge, undefined);
  assert.ok(g.combat.status('overcharge').progress > 0.9);
  const ring = target(99, g.position.x, g.position.y, 1000);
  g.targets = [ring];
  g.combat.killed(target(98, 0, 0, 1));
  g.advance(500);
  assert.ok(g.combat.activations.overcharge !== undefined);
  assert.ok(ring.hp < 1000);
  close(g.combat.status('overcharge').progress, 0);
});

test('thunderstrike splashes its impact and links impact points at rank five', () => {
  const g = stationarySkill({ strike: 1 }, []);
  const { x, y } = g.position;
  const tough = target(0, x + 40, y, 500, 'dense');
  const beside = target(1, x + 40 + g.forms.strike.splash - 4, y, 500);
  g.targets = [tough, beside];
  g.combat.fireSkill('strike');
  g.advance(500);
  assert.ok(tough.hp < 500 && beside.hp < 500, 'The splash hits the neighbour');
  const h = stationarySkill({ strike: 5 }, []);
  const a = target(0, h.position.x + 30, h.position.y - 40, 5000, 'dense'),
    b = target(1, h.position.x + 30, h.position.y + 40, 5000, 'dense'),
    between = target(2, h.position.x + 30, h.position.y, 5000);
  between.maxHp = 1;
  h.targets = [a, b, between];
  h.combat.fireSkill('strike');
  h.advance(500);
  assert.ok(between.hp < 5000);
  assert.ok(h.events.some((e) => e.kind === 'thunder'));
});

test('new skills survive a natural checkpoint and reproduce future combat and mass', () => {
  let checked = false;
  for (let seed = 92000; seed < 92050 && !checked; seed++) {
    const g = new Game(seed);
    g.start();
    while (g.phase === 'running' && g.time < 180) {
      g.advance(1000 / rules.tickRate);
      const card = g.choice?.cards.find((c) => c.id === 'spark' || c.id === 'fission');
      if (card) g.select(card.id);
      if (!g.ranks.spark && !g.ranks.fission) continue;
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

test('every evolution changes combat for its skill', () => {
  const run = (id: (typeof skillIds)[number], evolved: boolean, durable: number) => {
    const g = stationarySkill({}, []);
    for (let r = 0; r < 5; r++) choose(g, id);
    // Fork spreads hits across the crowd so marks and links can build.
    if (id !== 'multi') for (let r = 0; r < 5; r++) choose(g, 'multi');
    g.evolved[id] = evolved;
    // A dense, durable crowd around the electron, with basic fire on and spawns off.
    const { x, y } = g.position;
    g.targets = Array.from({ length: 60 }, (_, i) => {
      const angle = i * 2.4,
        r = 14 + (i % 10) * (durable ? 9 : 24);
      return target(i, x + Math.cos(angle) * r, y + Math.sin(angle) * r, i % 3 < durable ? 300 : 4);
    });
    g.counts.quark.generated = g.targets.length;
    g.combatEnabled = true;
    (g as unknown as { nextSpawn: number }).nextSpawn = Infinity;
    (g.combat as unknown as { heat: number }).heat = g.forms.overcharge.kills - 1;
    for (let i = 0; i < 600; i++) {
      g.choice = null;
      if (i % 20 === 0) g.resonate((((i / 20) % 3) + 1) as 1 | 2 | 3);
      g.advance(1000 / rules.tickRate);
    }
    return g.events.reduce(
      (sum, e) => sum + (e.kind === 'hit' ? (e.data as { damage: number }).damage : 0),
      0,
    );
  };
  // A sparse fragile crowd for long dominoes, then fragile and durable dense crowds.
  const same = skillIds.filter((id) =>
    [0, 1, 2].every((durable) => run(id, true, durable) === run(id, false, durable)),
  );
  assert.deepEqual(same, []);
});
