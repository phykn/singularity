import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { isSkill, rules } from '../src/game/rules.ts';
import { fixture, pick, target } from './helpers.ts';

const broad = ['chain', 'multi', 'pierce', 'satellite', 'strike'];

function firstOffer(seed: number) {
  const g = new Game(seed);
  g.start();
  while (!g.choice && g.phase === 'running') g.run(1);
  return g;
}

test('the first offer is skills only and leads with a broad skill', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const cards = firstOffer(seed).choice!.cards.map((c) => c.id);
    assert.equal(cards.length, rules.growth.choiceCount);
    assert.ok(cards.every(isSkill), `seed ${seed}: ${cards}`);
    assert.ok(broad.includes(cards[0]), `seed ${seed}: ${cards}`);
  }
});

test('in danger with mass to release, mass release leads and is picked first', () => {
  const g = firstOffer(3);
  pick(g);
  g.mass = 60;
  g.radius = g.core + rules.orbit.electronRadius + rules.orbit.dangerMargin - 1;
  g.xp = rules.growth.levelXp[1] - rules.particles.quark.xp;
  const victim = target(99, 180, 150, 1);
  g.targets.push(victim);
  g.damageTarget(victim, 5);
  assert.ok(g.choice, 'a new offer opened');
  assert.equal(g.choice!.cards[0].id, 'recover');
  assert.equal(g.automaticCard!.id, 'recover');
});

test('automatic choice takes power or rate below the auto rank before rarity', () => {
  const g = firstOffer(5);
  g.choice = {
    number: g.choice!.number,
    cards: [
      { id: 'multi', rarity: 'legendary' },
      { id: 'rate', rarity: 'common' },
      { id: 'range', rarity: 'common' },
    ],
  };
  assert.equal(g.automaticCard!.id, 'rate');
  g.boosts.rate = rules.growth.autoStatRank;
  assert.equal(g.automaticCard!.id, 'multi');
});

test('stale numbers and unknown cards are ignored; a pick is recorded for replay', () => {
  const g = firstOffer(7),
    { number, cards } = g.choice!;
  assert.equal(g.choose(cards[0].id, number + 1), false);
  assert.equal(g.choose('luck', number), false);
  assert.equal(g.choose(cards[0].id, number), true);
  assert.equal(g.ranks[cards[0].id as 'multi'], 1);
  assert.deepEqual(g.inputs.at(-1), {
    tick: g.elapsedTicks,
    kind: 'card',
    id: cards[0].id,
    number,
  });
});

test('five kills in one tick: tap pops in turn, burst all at once', () => {
  const tap = fixture(
    {},
    [0, 1, 2, 3, 4].map((i) => target(i, 180 + i * 4, 140)),
  );
  for (const t of [...tap.targets]) tap.damageTarget(t, 99, false, 'tap');
  const stagger = rules.combat.pops.tap.stagger;
  assert.deepEqual(
    tap.effects.filter((fx) => fx.kind === 'kill').map((fx) => +fx.delay!.toFixed(3)),
    [0, 1, 2, 3, 4].map((i) => +Math.min(rules.combat.pops.tap.max, i * stagger).toFixed(3)),
  );
  const fork = fixture(
    { multi: 4 },
    [0, 1, 2, 3, 4].map((i) => target(i, 180 + i * 4, 160, 1)),
  );
  fork.angle = -Math.PI / 2;
  fork.combat.fireBasic();
  const kills = fork.effects.filter((fx) => fx.kind === 'kill');
  assert.equal(kills.length, 5);
  assert.ok(kills.every((fx) => fx.delay === 0));
});

test('Death Arc throws from the first kill; Pierce sweeps the line in order', () => {
  const arc = fixture({ burst: 1 }, [
    target(0, 180, 160, 1),
    target(1, 200, 160, 1),
    target(2, 160, 165, 1),
  ]);
  arc.combat.fireBasic();
  assert.equal(arc.targets.length, 0);
  const line = fixture({ pierce: 1 }, [
    target(0, 180, 150, 1),
    target(1, 180, 200, 1),
    target(2, 180, 230, 1),
  ]);
  line.combat.fireBasic();
  const delays = line.effects.filter((fx) => fx.kind === 'kill').map((fx) => fx.delay!);
  assert.equal(delays.length, 3);
  assert.ok(delays[1] < delays[2], `${delays}`);
});

test('Repeat adds hits after the delay', () => {
  const g = fixture({ repeat: 2 }, [target(0, 180, 160, 100)]);
  g.combat.fireBasic();
  const after = g.targets[0].hp;
  g.run(Math.ceil(rules.skills.repeat.delaySeconds * rules.time.tickRate * 2) + 1);
  assert.ok(g.targets[0].hp < after);
});
