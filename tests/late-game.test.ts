import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import { rules } from '../src/game/rules.ts';
import type { Ranks } from '../src/game/rules.ts';
import { pactText } from '../src/ui/skillText.ts';
import { copy, languages } from '../src/ui/i18n.ts';
import { choose, fixture, stationarySkill, target } from './helpers.ts';
import { playRhythm } from '../scripts/rhythm-bot.ts';

const tick = (g: Game) => g.advance(1000 / rules.tickRate);
const energy = (fraction: number) => Math.ceil(rules.energyGoal * fraction);
const spawned = () => {
  const g = new Game(5);
  g.start();
  return g;
};

test('critical breach starts once at its energy, tightens the orbit and strengthens spawns', () => {
  const g = fixture();
  const relaxed = g.targetRadius;
  g.debugSetXp(energy(rules.critical.energyFraction) - 1);
  g.choice = null;
  assert.equal(g.critical, false);
  g.xp = energy(rules.critical.energyFraction);
  assert.equal(g.critical, true);
  assert.equal(g.targetRadius, relaxed - rules.critical.pull);
  assert.equal(g.enemyStrength.hp, rules.critical.hpScale);
  g.selections.length = 100;
  tick(g);
  tick(g);
  assert.equal(g.events.filter((event) => event.kind === 'critical').length, 1);
  assert.equal(g.banner?.kind, 'critical');
});

test('critical breach slows energy without losing fractions and ends at the normal goal', () => {
  const g = fixture();
  g.xp = energy(rules.critical.energyFraction);
  g.selections.length = 100;
  const start = g.xp;
  for (let i = 0; i < 5; i++) {
    g.targets = [target(i, 180, 128, 1)];
    g.combat.fireBasic(g.targets[0]);
  }
  assert.equal(g.xp, start + Math.floor(5 * rules.critical.xpScale));
});

test('the boss arrives once at its energy with a warning, resists control and reports its fate', () => {
  const g = spawned();
  g.selections.length = 100;
  g.xp = energy(rules.boss.energyFraction);
  tick(g);
  const boss = g.boss!;
  assert.equal(boss.kind, 'boss');
  assert.equal(g.banner?.kind, 'boss');
  assert.equal(g.events.filter((event) => event.kind === 'boss').length, 1);
  g.targets = g.targets.filter((t) => t === boss);
  tick(g);
  assert.equal(g.events.filter((event) => event.kind === 'boss').length, 1);
  assert.equal(g.combat.movementScale({ ...boss, bridgeUntil: Infinity }), 1);
  boss.radius = g.core;
  const mass = g.mass;
  g.absorbTargets();
  assert.equal(g.mass, mass + rules.boss.mass);
  assert.equal(g.events.filter((event) => event.kind === 'boss-absorbed').length, 1);
  assert.equal(g.boss, undefined);
});

test('the core grows while the boss lives and stops once it is gone', () => {
  const g = fixture();
  g.selections.length = 100;
  const boss = target(1, 180, 60, 1e6);
  boss.kind = 'boss';
  g.targets = [boss];
  const seconds = 5;
  for (let i = 0; i < seconds * rules.tickRate; i++) tick(g);
  assert.equal(g.mass, Math.floor(seconds / rules.boss.feedSeconds));
  g.targets = [];
  const mass = g.mass;
  for (let i = 0; i < seconds * rules.tickRate; i++) tick(g);
  assert.equal(g.mass, mass);
});

test('damaging the boss summons each escort group once and a kill pays its reward', () => {
  const g = spawned();
  g.selections.length = 100;
  g.xp = energy(rules.boss.energyFraction);
  tick(g);
  const boss = g.boss!;
  g.targets = [boss];
  g.damageTarget(boss, boss.maxHp * 0.4);
  assert.equal(g.targets.length, 1 + rules.boss.summonCount);
  g.damageTarget(boss, 1);
  assert.equal(g.targets.length, 1 + rules.boss.summonCount);
  g.damageTarget(boss, boss.maxHp * 0.4);
  assert.equal(g.targets.length, 1 + 2 * rules.boss.summonCount);
  const xp = g.xp;
  g.damageTarget(boss, boss.maxHp);
  assert.equal(g.xp, xp + rules.boss.xp);
  assert.equal(g.banner?.kind, 'boss-down');
  assert.equal(g.events.filter((event) => event.kind === 'boss-down').length, 1);
});

test('the boss and critical breach stay out of endless play', () => {
  const g = new Game(1500003);
  playRhythm(g, undefined, false);
  assert.equal(g.result?.outcome, 'success');
  assert.ok(g.continueBeyond());
  assert.equal(g.critical, false);
  while (g.phase === 'crossing') tick(g);
  const seen = g.events.filter((event) => event.kind === 'boss').length;
  for (let i = 0; i < 600 && g.phase === 'running'; i++) {
    g.choice = null;
    tick(g);
  }
  assert.equal(g.events.filter((event) => event.kind === 'boss').length, seen);
});

test('evolution cards need maximum rank and an unused energy threshold', () => {
  const g = fixture({ chain: 5 });
  g.selections = Array.from({ length: 3 }, () => ({ id: 'chain', tick: 0, time: 0 }) as never);
  g.xp = energy(rules.evolution.energyFractions[0]) - 1;
  const privateOpen = g as unknown as { openChoice(): void };
  privateOpen.openChoice();
  assert.ok(g.choice);
  assert.equal(
    g.choice!.cards.some((card) => card.evolve),
    false,
  );
  g.choice = null;
  g.xp = energy(rules.evolution.energyFractions[0]);
  privateOpen.openChoice();
  const card = g.choice!.cards[0];
  assert.deepEqual([card.id, card.evolve], ['chain', true]);
  assert.equal(g.automaticCard?.id, 'chain');
  assert.ok(g.select('chain'));
  assert.equal(g.evolved.chain, true);
  assert.equal(g.ranks.chain, 5);
  assert.equal(g.selections.at(-1)!.evolve, true);
  privateOpen.openChoice();
  assert.equal(
    g.choice!.cards.some((entry) => entry.evolve),
    false,
  );
});

test('skills without an evolution never offer one', () => {
  const g = fixture({ repeat: 5 });
  g.selections = Array.from({ length: 3 }, () => ({ id: 'repeat', tick: 0, time: 0 }) as never);
  g.xp = rules.energyGoal - 1;
  (g as unknown as { openChoice(): void }).openChoice();
  assert.equal(
    g.choice!.cards.some((card) => card.evolve),
    false,
  );
});

const damage = (ranks: Partial<Ranks>, evolved: boolean, run: (g: Game) => void, count = 4) => {
  const targets = Array.from({ length: count }, (_, i) => target(i, 180 + i * 10, 128, 1e6));
  const g = stationarySkill(ranks, targets);
  if (evolved) for (const id of Object.keys(ranks)) g.evolved[id as keyof Ranks] = true;
  run(g);
  return targets.reduce((sum, t) => sum + t.maxHp - t.hp, 0);
};

test('each evolution adds damage to the skill it changes', () => {
  const fire = (g: Game) => {
    g.combat.fireBasic(g.position);
  };
  for (const ranks of [{ chain: 5 }, { multi: 5 }] as Partial<Ranks>[])
    assert.ok(damage(ranks, true, fire) > damage(ranks, false, fire), Object.keys(ranks)[0]);
  const linger = (g: Game) => {
    g.combat.fireBasic(g.position);
    for (let i = 0; i < rules.tickRate; i++) {
      g.tick++;
      g.combat.update();
    }
  };
  assert.ok(damage({ pierce: 5 }, true, linger) > damage({ pierce: 5 }, false, linger));
  const total = (evolved: boolean) => {
    const g = stationarySkill({ satellite: 5 }, []);
    g.evolved.satellite = evolved;
    g.targets = Array.from({ length: 12 }, (_, i) => {
      const angle = (i * Math.PI) / 6;
      const { x, y } = g.position;
      return target(i, x + Math.cos(angle) * 18, y + Math.sin(angle) * 18, 1e6);
    });
    g.combat.fireSkill('satellite');
    return g.targets.reduce((sum, t) => sum + t.maxHp - t.hp, 0);
  };
  assert.ok(total(true) > total(false));
});

test('pacts apply their gain and cost once and are never picked automatically', () => {
  const g = fixture();
  g.mass = 0;
  g.choice = {
    number: 1,
    opened: 0,
    deadline: 8,
    cards: [
      { id: 'overload', rarity: 'common' },
      { id: 'range', rarity: 'common' },
    ],
  };
  assert.equal(g.automaticCard?.id, 'range');
  assert.ok(g.select('overload'));
  assert.equal(g.boosts.power, rules.pacts.overload.power);
  assert.equal(g.mass, rules.pacts.overload.mass);
  assert.equal(g.rank('overload'), 1);

  const fast = fixture();
  fast.mass = 200;
  assert.equal(fast.recoverable, true);
  fast.choice = {
    number: 1,
    opened: 0,
    deadline: 8,
    cards: [{ id: 'overclock', rarity: 'common' }],
  };
  assert.ok(fast.select('overclock'));
  assert.equal(fast.boosts.rate, rules.pacts.overclock.rate);
  assert.equal(fast.recoverable, false);

  const greedy = fixture();
  greedy.choice = { number: 1, opened: 0, deadline: 8, cards: [{ id: 'greed', rarity: 'common' }] };
  assert.ok(greedy.select('greed'));
  for (let i = 0; i < 20; i++) {
    greedy.targets = [target(i, 180, 128, 1)];
    greedy.combat.fireBasic(greedy.targets[0]);
  }
  assert.equal(greedy.xp, Math.floor(20 * (1 + rules.pacts.greed.xp)));
  const walker = target(99, 180, 100, 1000);
  walker.speed = 10;
  greedy.targets = [walker];
  const before = walker.radius;
  greedy.moveTargets();
  assert.ok(
    Math.abs(before - walker.radius - (10 * (1 + rules.pacts.greed.enemySpeed)) / rules.tickRate) <
      1e-9,
  );
});

test('pact cards appear on their interval, never in danger and at most once each', () => {
  const offers = (mass: number) => {
    const g = fixture({ repeat: 1, chain: 1 });
    g.mass = mass;
    g.selections = Array.from(
      { length: rules.pacts.interval - 1 },
      () => ({ id: 'power' }) as never,
    );
    g.xp = rules.levelXp[rules.pacts.interval];
    (g as unknown as { openChoice(): void }).openChoice();
    return g;
  };
  const safe = offers(0);
  const pact = safe.choice!.cards.find((card) =>
    ['overload', 'greed', 'overclock'].includes(card.id),
  );
  assert.ok(pact);
  assert.ok(safe.select(pact.id));
  assert.equal(safe.canUpgrade(pact.id), false);
  const danger = offers(1000);
  danger.radius = danger.core + 1;
  danger.choice = null;
  (danger as unknown as { openChoice(): void }).openChoice();
  assert.equal(
    danger.choice!.cards.some((card) => ['overload', 'greed', 'overclock'].includes(card.id)),
    false,
  );
});

test('checkpoints replay evolutions and pacts under current rules', () => {
  const g = new Game(900000);
  playRhythm(g, (game) => {
    const cards = game.choice!.cards;
    return (
      cards.find((card) => card.evolve) ??
      cards.find((card) => card.id === 'greed' || card.id === 'overload') ??
      game.automaticCard!
    );
  });
  const checkpoint = createCheckpoint(g)!;
  const restored = restoreCheckpoint(structuredClone(checkpoint));
  assert.deepEqual(restored?.pacts, g.pacts);
  assert.deepEqual(restored?.evolved, g.evolved);
  assert.equal(restored?.xp, g.xp);
  assert.ok(Object.keys(g.evolved).length > 0, 'The run must evolve a skill');
  assert.ok(Object.keys(g.pacts).length > 0, 'The run must take a pact');
});

test('every language describes pacts, evolutions and event banners', () => {
  for (const { id } of languages) {
    const c = copy[id];
    for (const pact of ['overload', 'greed', 'overclock'] as const) {
      const { gain, cost } = pactText(pact, id);
      assert.ok(gain.length && cost.length, pact);
      assert.ok(c.upgrades[pact].description.length);
    }
    for (const skill of ['chain', 'multi', 'pierce', 'satellite'] as const)
      assert.ok(c.evolutions[skill].name && c.evolutions[skill].summary);
    assert.ok(c.banners.critical && c.banners.boss && c.banners['boss-down']);
  }
});
