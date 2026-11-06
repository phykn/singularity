import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { apply } from '../src/game/replay.ts';
import { evolutionChance, isPact, pactIds, rules, xpForLevel } from '../src/game/rules.ts';
import type { Card } from '../src/game/rules.ts';
import { fixture, session, target } from './helpers.ts';

const o = rules.orbit;
// Puts the orbit `margin` away from the core.
const atMargin = (g: Game, margin: number) => (g.radius = g.core + o.electronRadius + margin);

// The cards of offer `number`; every card-stream draw returns `roll`.
function offer(roll: number, number: number, ranks = { multi: 5, chain: 1 }, margin?: number) {
  const g = fixture(ranks);
  g['random'].cards.next = () => roll;
  g.xp = xpForLevel(30, rules);
  for (let i = 1; i < number; i++)
    g.selections.push({ time: 0, id: 'power', rank: i, rarity: 'common', evolve: false });
  if (margin !== undefined) atMargin(g, margin);
  g['openChoice']();
  assert.equal(g.choice!.number, number);
  return g.choice!.cards;
}
const pacts = (cards: Card[]) => cards.filter((c) => isPact(c.id)).length;

test('a pact replaces the last card every interval, never beside an evolution or in danger', () => {
  const interval = rules.growth.pacts.interval,
    cards = offer(0.5, interval);
  assert.ok(isPact(cards.at(-1)!.id), JSON.stringify(cards));
  assert.equal(cards.filter((c) => c.evolve).length, 0);
  assert.equal(pacts(offer(0.5, interval - 1)), 0);
  assert.equal(pacts(offer(0.5, 2 * interval)), 1);
  const evolving = offer(evolutionChance(0, rules) / 2, interval);
  assert.equal(evolving.filter((c) => c.evolve).length, 1);
  assert.equal(pacts(evolving), 0, JSON.stringify(evolving));
  assert.equal(pacts(offer(0.5, interval, undefined, o.dangerMargin - 1)), 0, 'in danger');
  assert.equal(pacts(offer(0.5, interval, { multi: 1 })), 0, 'fewer than minSkills skills');
});

test('a pact is taken once, logged, and the pact limit holds', () => {
  const g = fixture({ multi: 1, chain: 1 });
  for (const [i, id] of pactIds.entries()) {
    g.choice = { number: g.selections.length + 1, cards: [{ id, rarity: 'common' }] };
    assert.equal(g.choose(id, g.choice.number), i < rules.growth.pacts.max, id);
  }
  assert.equal(g.pactCount, rules.growth.pacts.max);
  assert.deepEqual(
    g.events.filter((e) => e.kind === 'pact').map((e) => e.data.id),
    pactIds.slice(0, rules.growth.pacts.max),
  );
  assert.equal(g.rank(pactIds[0]), 1);
});

test('automatic choice takes an evolution first and a pact only with margin to spare', () => {
  const g = fixture({ multi: 5, chain: 2 });
  g.choice = {
    number: 1,
    cards: [
      { id: 'range', rarity: 'common' },
      { id: 'overheat', rarity: 'common' },
      { id: 'chain', rarity: 'legendary' },
    ],
  };
  atMargin(g, o.autoPactMargin);
  assert.equal(g.automaticCard!.id, 'chain');
  atMargin(g, o.autoPactMargin + 1);
  assert.equal(g.automaticCard!.id, 'overheat');
  g.choice.cards.push({ id: 'multi', rarity: 'rare', evolve: true });
  assert.deepEqual(g.automaticCard, { id: 'multi', rarity: 'rare', evolve: true });
});

const finishMass = rules.combat.resonance.finishMass;
function beats(g: Game) {
  for (const beat of [1, 2, 3] as const) (g.run(1), assert.equal(g.resonate(beat), true));
}

test('with Overclock, three beats shed no mass and mass release is closed', () => {
  const g = fixture({}, [target(1, 180, 420, 1e6)]),
    mass = rules.growth.recovery.minMass + 10;
  g.mass = mass;
  assert.equal(g.recoverable, true);
  beats(g);
  assert.equal(g.mass, mass - finishMass);
  g.pacts.overclock = true;
  assert.equal(g.recoverable, false);
  beats(g);
  assert.equal(g.mass, mass - finishMass);
});

test('a missed beat costs missMass only under Pulse, and replays', () => {
  const g = fixture();
  g.mass = 5;
  g.run(1);
  assert.equal(g.resonate(0), true);
  assert.equal(g.mass, 5);
  g.pacts.pulse = true;
  g.run(1);
  assert.equal(apply(g, { tick: g.elapsedTicks, kind: 'beat', beat: 0 }), true);
  assert.equal(g.mass, 5 + rules.pacts.pulse.missMass);
  assert.deepEqual(g.inputs.at(-1), { tick: g.elapsedTicks, kind: 'beat', beat: 0 });
});

test('under Pulse the session turns a wrong tap and a passed gate into missed beats', () => {
  const { s } = session(false);
  // Without combat no card offer interrupts the rhythm.
  s.replace(new Game(7, { combat: false }), 0);
  s.start(0);
  s.game.pacts.pulse = true;
  let wall = 0;
  const step = () => s.frame((wall += 1000 / 60));
  const missed = () => s.game.inputs.filter((i) => i.kind === 'beat' && i.beat === 0).length;
  while (!(s.rhythm.active && !s.rhythm.open)) step();
  const mass = s.game.mass;
  s.tap(wall);
  assert.equal(missed(), 1, 'a tap off the gate');
  assert.equal(s.game.mass, mass + rules.pacts.pulse.missMass);
  // Hit the first beat of the next round, then let the second gate pass.
  while (!(s.rhythm.open && s.rhythm.due <= s.rhythm.age)) step();
  s.tap(wall);
  assert.equal(s.rhythm.hits, 1);
  while (s.rhythm.active) step();
  for (let i = 0; i < 10; i++) step();
  assert.equal(missed(), 2, 'a gate passed after the first hit');
});
