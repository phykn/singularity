import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import { orbit } from '../src/game/geometry.ts';
import { rules } from '../src/game/rules.ts';
import type { Ranks } from '../src/game/rules.ts';
import type { Phase } from '../src/game/types.ts';
import { choose, close, stationarySkill, target } from './helpers.ts';

test('resonance rules leave runs with no manual input unchanged', () => {
  const normal = new Game(1701);
  const alternate = new Game(1701, {
    rules: {
      ...rules,
      resonance: { beatDamage: 100, finishDamage: 100 },
    },
  });
  for (const g of [normal, alternate]) {
    g.start();
    g.advance(600000);
    assert.deepEqual(g.resonances, []);
  }
  assert.deepEqual(alternate.result, normal.result);
  assert.deepEqual(alternate.events, normal.events);
  assert.deepEqual(alternate.targets, normal.targets);
});

test('first two beats deal real small hits and scale Charge children without inflating contribution', () => {
  const enemy = target(1, 180, 128, 100000);
  const g = stationarySkill({ charge: 1 }, [enemy]);
  assert.ok(g.resonate(1));
  close(enemy.hp, 100000 - g.damage * rules.resonance.beatDamage);
  close(g.combat.status('charge').progress, 1 / g.forms.charge.threshold);
  g.advance(1000 / rules.tickRate);
  assert.ok(g.resonate(2));
  close(enemy.hp, 100000 - 2 * g.damage * rules.resonance.beatDamage);

  const heavy = target(2, 180, 128, 100000);
  const charged = stationarySkill({ charge: 1 }, [heavy]);
  for (let i = 0; i < 3; i++) charged.combat.fireBasic();
  const before = heavy.hp;
  assert.ok(charged.resonate(1));
  close(
    before - heavy.hp,
    charged.damage * rules.resonance.beatDamage * (1 + charged.forms.charge.damage),
  );
});

test('small beats preserve Burst synergy while adding only one direct target with Multi', () => {
  const primary = target(1, 180, 128, 1);
  const survivor = target(2, 190, 128, 1000);
  const g = stationarySkill({ burst: 1 }, [primary, survivor]);
  assert.ok(g.resonate(1));
  close(survivor.hp, 1000 - g.damage * rules.resonance.beatDamage * g.forms.burst.damage);
  const targets = [target(1, 180, 128, 1000), target(2, 190, 128, 1000), target(3, 180, 260, 1000)];
  const multi = stationarySkill({ multi: 5 }, targets);
  assert.ok(multi.resonate(2));
  assert.deepEqual(
    targets.map((t) => t.hp < 1000),
    [true, false, false],
  );
});

test('third beat hits every enemy once, including the core and distant particles', () => {
  const points = Array.from({ length: 10 }, (_, i) => orbit((i * Math.PI) / 5, rules.orbitRadius));
  const enemies = points.map((p, i) => target(i, p.x, p.y, 1000));
  enemies.push(target(10, 180, 260, 1000));
  const far = orbit(0, 350);
  enemies.push(target(11, far.x, far.y, 1000));
  const g = stationarySkill({ multi: 5, repeat: 5, return: 5 }, enemies);
  assert.ok(g.resonate(3));
  assert.equal(enemies.filter((t) => t.hp < 1000).length, enemies.length);
  for (const enemy of enemies.filter((t) => t.hp < 1000))
    close(enemy.hp, 1000 - g.damage * rules.resonance.finishDamage);
  const damage = enemies.map((t) => t.hp);
  g.advance(1000);
  assert.deepEqual(
    enemies.map((t) => t.hp),
    damage,
  );
  assert.ok(g.effects.every((fx) => fx.kind !== 'return'));
});

test('global discharge ignores orbit contraction and does not multiply damage through Burst', () => {
  const p = orbit(0, 70),
    q = orbit(0.05, 70),
    old = orbit(0, rules.orbitRadius);
  const enemies = [
    target(1, p.x, p.y, 1),
    target(2, q.x, q.y, 1000),
    target(3, old.x, old.y, 1000),
  ];
  const g = stationarySkill({ burst: 1 }, enemies);
  const [weak, survivor, outside] = enemies;
  g.radius = 70;
  assert.ok(g.resonate(3));
  assert.equal(weak.hp, 0);
  close(survivor.hp, 1000 - g.damage * rules.resonance.finishDamage);
  close(outside.hp, 1000 - g.damage * rules.resonance.finishDamage);
});

test('beat rewards add repeats without changing scheduled basic or timed attacks', () => {
  const run = (resonate: boolean) => {
    const g = new Game(42, {
      rules: { ...rules, baseSpeed: 0, spawnSecondsByStage: Array(5).fill(10000) },
    });
    g.start();
    choose(g, 'repeat');
    choose(g, 'strike');
    const enemy = target(1, 180, 128, 100000);
    g.targets = [enemy];
    if (resonate) assert.ok(g.resonate(1));
    g.advance(1000);
    return { g, damage: 100000 - enemy.hp };
  };
  const plain = run(false),
    manual = run(true);
  close(
    manual.damage - plain.damage,
    plain.g.damage * rules.resonance.beatDamage * (1 + plain.g.forms.repeat.damage),
  );
  const strikes = (g: Game) =>
    g.events.filter(
      (event) => event.kind === 'skill-effect' && (event.data as { id: string }).id === 'strike',
    ).length;
  assert.equal(strikes(manual.g), strikes(plain.g));
  assert.equal(manual.g.mass, plain.g.mass);
});

test('all beats require active play and accept empty arenas once per tick', () => {
  for (const phase of ['ready', 'collapse', 'ending', 'result', 'crossing'] as Phase[]) {
    const g = stationarySkill({}, []);
    g.phase = phase;
    assert.equal(g.resonate(1), false);
  }
  const g = stationarySkill({}, []);
  g.manualPaused = true;
  assert.equal(g.resonate(1), false);
  g.manualPaused = false;
  g.hiddenPaused = true;
  assert.equal(g.resonate(2), false);
  g.hiddenPaused = false;
  g.choice = { number: 1, opened: 0, deadline: 5, cards: [{ id: 'power', rarity: 'common' }] };
  assert.equal(g.resonate(3), false);
  g.choice = null;
  g.xp = rules.energyGoal;
  assert.equal(g.resonate(1), false);
  g.xp = 0;
  assert.ok(g.resonate(1));
  assert.equal(g.resonate(2), false);
  assert.deepEqual(g.resonances, [{ tick: 0, selectionCount: 0, beat: 1 }]);
  g.advance(1000 / rules.tickRate);
  assert.ok(g.resonate(2));
  assert.equal(g.targets.length, 0);
});

test('maximum modifier builds conserve particles and exhaust bounded finish reactions', () => {
  const builds: Partial<Ranks>[] = [
    { repeat: 5, chain: 5, charge: 5, burst: 5 },
    { repeat: 5, multi: 5, chain: 5, pierce: 5 },
    { repeat: 5, multi: 5, charge: 5, return: 5 },
  ];
  for (const ranks of builds) {
    const enemies = Array.from({ length: 400 }, (_, id) =>
      target(id, 190 + (id % 40), 112 + Math.floor(id / 40) * 4, id % 2 ? 100 : 1),
    );
    const g = stationarySkill(ranks, enemies);
    for (const id of Object.keys(ranks) as (keyof Ranks)[]) g.rarities[id] = 'legendary';
    assert.ok(g.resonate(3));
    g.advance(3000);
    const hits = g.events.filter((event) => event.kind === 'hit').length;
    assert.ok(hits < 50000);
    assert.ok(g.effects.length <= 160);
    assert.equal(g.xp + g.targets.length + g.counts.quark.absorbed, 400);
    g.advance(4000);
    assert.equal(g.events.filter((event) => event.kind === 'hit').length, hits);
    assert.ok(g.targets.every((t) => Number.isFinite(t.hp) && t.hp > 0));
  }
});

test('checkpoints replay each beat with the current mandatory format', () => {
  const g = new Game(1701);
  g.start();
  for (let i = 0; i < 60; i++) {
    g.advance(500);
    if (!g.choice) g.resonate(((i % 3) + 1) as 1 | 2 | 3);
  }
  const checkpoint = createCheckpoint(g)!;
  assert.deepEqual(new Set(checkpoint.resonances.map((r) => r.beat)), new Set([1, 2, 3]));
  const restored = restoreCheckpoint(JSON.parse(JSON.stringify(checkpoint)))!;
  assert.ok(restored);
  assert.deepEqual(createCheckpoint(restored), checkpoint);
  assert.deepEqual(restored.targets, g.targets);
  assert.deepEqual(restored.events, g.events);
  assert.deepEqual(restored.effects, g.effects);
  assert.deepEqual(restored.damageNumbers, g.damageNumbers);
  const missing = { ...checkpoint };
  Reflect.deleteProperty(missing, 'resonances');
  assert.equal(restoreCheckpoint(missing), null);
  const missingBeat = JSON.parse(JSON.stringify(checkpoint));
  delete missingBeat.resonances[0].beat;
  assert.equal(restoreCheckpoint(missingBeat), null);
});

test('checkpoints order beats after manual and before-combat choices in the same tick', () => {
  for (const beforeCombat of [false, true]) {
    const g = new Game(1701);
    g.start();
    while (!g.choice) g.advance(1000 / rules.tickRate);
    const card = g.choice!.cards[0];
    if (beforeCombat)
      g.advance(1000 / rules.tickRate, 1, {
        autoSelect: false,
        beforeCombat: () => {
          assert.ok(g.select(card.id, true, g.choice!.number, true));
        },
      });
    else assert.ok(g.select(card.id));
    assert.ok(g.resonate(1));
    assert.equal(g.resonances.at(-1)!.tick, g.selections.at(-1)!.tick);
    assert.equal(g.resonances.at(-1)!.selectionCount, g.selections.length);
    g.advance(100);
    const restored = restoreCheckpoint(createCheckpoint(g)!)!;
    assert.ok(restored);
    assert.deepEqual(restored.events, g.events);
    assert.deepEqual(restored.targets, g.targets);
    assert.deepEqual(createCheckpoint(restored), createCheckpoint(g));
  }
});
