import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import { rules } from '../src/game/rules.ts';
import type { Ranks } from '../src/game/rules.ts';
import type { Phase } from '../src/game/types.ts';
import { choose, close, stationarySkill, target } from './helpers.ts';

test('the resonance rule leaves runs with no resonance input unchanged', () => {
  const normal = new Game(1701);
  const alternate = new Game(1701, { rules: { ...rules, resonanceDamage: 100 } });
  for (const g of [normal, alternate]) {
    g.start();
    g.advance(600000);
    assert.deepEqual(g.resonances, []);
  }
  assert.deepEqual(alternate.result, normal.result);
  assert.deepEqual(alternate.events, normal.events);
  assert.deepEqual(alternate.targets, normal.targets);
});

test('resonance doubles primary and Charge damage without doubling charge contribution', () => {
  const enemy = target(1, 180, 128, 100000);
  const g = stationarySkill({ charge: 1 }, [enemy]);
  assert.ok(g.resonate());
  close(enemy.hp, 100000 - g.damage * rules.resonanceDamage);
  close(g.combat.status('charge').progress, 1 / g.forms.charge.threshold);

  const heavy = target(2, 180, 128, 100000);
  const charged = stationarySkill({ charge: 1 }, [heavy]);
  for (let i = 0; i < 3; i++) charged.combat.fireBasic();
  const before = heavy.hp;
  assert.ok(charged.resonate());
  close(
    before - heavy.hp,
    charged.damage * rules.resonanceDamage * (1 + charged.forms.charge.damage),
  );
  close(charged.combat.status('charge').progress, 0);
});

test('resonance scales Burst children and respects the normal range and Multi coverage', () => {
  const primary = target(1, 180, 128, 1);
  const survivor = target(2, 190, 128, 1000);
  const g = stationarySkill({ burst: 1 }, [primary, survivor]);
  assert.ok(g.resonate());
  close(survivor.hp, 1000 - g.damage * rules.resonanceDamage * g.forms.burst.damage);

  const targets = [
    target(1, 180, 128, 1000),
    target(2, 190, 128, 1000),
    target(3, 200, 128, 1000),
    target(4, 180, 260, 1000),
  ];
  const multi = stationarySkill({ multi: 1 }, targets);
  assert.ok(multi.resonate());
  assert.deepEqual(
    targets.map((t) => t.hp < 1000),
    [true, true, false, false],
  );
  close(targets[0].hp, 1000 - multi.damage * rules.resonanceDamage);
  close(targets[1].hp, 1000 - multi.damage * rules.resonanceDamage * multi.forms.multi.damage);
});

test('resonance adds its own repeats without duplicating scheduled basic or timed attacks', () => {
  const run = (resonate: boolean) => {
    const g = new Game(42, {
      rules: { ...rules, baseSpeed: 0, spawnSecondsByStage: Array(5).fill(10000) },
    });
    g.start();
    choose(g, 'repeat');
    choose(g, 'strike');
    const enemy = target(1, 180, 128, 100000);
    g.targets = [enemy];
    if (resonate) assert.ok(g.resonate());
    g.advance(1000);
    return { g, damage: 100000 - enemy.hp };
  };
  const plain = run(false);
  const manual = run(true);
  close(
    manual.damage - plain.damage,
    plain.g.damage * rules.resonanceDamage * (1 + plain.g.forms.repeat.damage),
  );
  const strikes = (g: Game) =>
    g.events.filter(
      (event) => event.kind === 'skill-effect' && (event.data as { id: string }).id === 'strike',
    ).length;
  assert.equal(strikes(manual.g), strikes(plain.g));
  assert.equal(manual.g.mass, plain.g.mass);
});

test('resonance requires an active unpaused run and accepts an empty arena once per tick', () => {
  for (const phase of ['ready', 'collapse', 'ending', 'result', 'crossing'] as Phase[]) {
    const g = stationarySkill({}, []);
    g.phase = phase;
    assert.equal(g.resonate(), false);
    assert.deepEqual(g.resonances, []);
  }
  const g = stationarySkill({}, []);
  g.manualPaused = true;
  assert.equal(g.resonate(), false);
  g.manualPaused = false;
  g.hiddenPaused = true;
  assert.equal(g.resonate(), false);
  g.hiddenPaused = false;
  g.choice = { number: 1, opened: 0, deadline: 5, cards: [{ id: 'power', rarity: 'common' }] };
  assert.equal(g.resonate(), false);
  g.choice = null;
  g.xp = rules.energyGoal;
  assert.equal(g.resonate(), false);
  g.xp = 0;
  assert.ok(g.resonate());
  assert.equal(g.resonate(), false);
  assert.deepEqual(g.resonances, [{ tick: 0, selectionCount: 0 }]);
  g.advance(1000 / rules.tickRate);
  assert.ok(g.resonate());
  assert.equal(g.resonances.length, 2);
  assert.equal(g.targets.length, 0);
});

test('maximum resonance modifier builds conserve particles and exhaust bounded reactions', () => {
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
    assert.ok(g.resonate());
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

test('checkpoints replay resonance rewards and preserve the mandatory current format', () => {
  const g = new Game(1701);
  g.start();
  for (let i = 0; i < 60; i++) {
    g.advance(500);
    if (!g.choice) g.resonate();
  }
  const checkpoint = createCheckpoint(g)!;
  assert.ok(checkpoint.resonances.length > 0);
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
});

test('checkpoints order resonance immediately after manual and before-combat choices in the same tick', () => {
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
    assert.ok(g.resonate());
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
