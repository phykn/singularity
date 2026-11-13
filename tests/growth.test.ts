import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { evolutionChance } from '../src/game/growth.ts';
import { isPact, isSkill, pactIds, rules, skillIds } from '../src/game/rules.ts';
import type { Ranks } from '../src/game/skills.ts';
import type { Card } from '../src/game/types.ts';
import { fixture, logged, pick, target } from './helpers.ts';

const o = rules.orbit,
  interval = rules.growth.pacts.interval;
// Puts the orbit `margin` away from the core.
const atMargin = (g: Game, margin: number) => (g.radius = g.core + o.electronRadius + margin);

function firstOffer(seed: number): Game {
  const g = new Game(seed);
  g.start();
  while (!g.growth.choice && g.phase === 'running') g.run(1);
  return g;
}
// Offer `number` of a levelled fixture; every draw on the cards stream returns `roll`, so the
// evolution roll lands where a test needs it.
function levelled(ranks: Partial<Ranks>, roll: number, number = 1, prepare?: (g: Game) => void) {
  const g = fixture(ranks);
  g.growth['cards'].next = () => roll;
  g.growth.xp = 1e6;
  for (let i = 1; i < number; i++)
    g.growth.selections.push({ time: 0, id: 'power', rank: i, rarity: 'common', evolve: false });
  prepare?.(g);
  g.growth.open();
  assert.equal(g.growth.choice!.number, number);
  return g;
}
const cards = (g: Game) => g.growth.choice!.cards;
const evolutions = (g: Game) => cards(g).filter((c) => c.evolve);
const pacts = (g: Game) => cards(g).filter((c) => isPact(c.id)).length;
const offer = (g: Game, ...offered: Card[]) =>
  (g.growth.choice = { number: g.growth.selections.length + 1, cards: offered });
// Takes the first card that is no evolution, pact or luck (luck would raise the chance).
function takePlain(g: Game): void {
  const card = cards(g).find(
    (c) => !c.evolve && !isPact(c.id) && c.id !== 'luck' && g.growth.canUpgrade(c.id),
  );
  assert.ok(card && g.choose(card.id, g.growth.choice!.number), JSON.stringify(cards(g)));
}

test('the first offer is skills only and leads with a broad skill', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const ids = cards(firstOffer(seed)).map((c) => c.id);
    assert.equal(ids.length, rules.growth.choiceCount);
    assert.ok(ids.every(isSkill), `seed ${seed}: ${ids}`);
    assert.ok(['chain', 'multi', 'pierce', 'satellite', 'strike'].includes(ids[0]), `${ids}`);
  }
});

test('in danger with mass to release, mass release leads and is picked first', () => {
  const g = firstOffer(3);
  pick(g);
  g.mass = 60;
  atMargin(g, o.dangerMargin - 1);
  g.growth.xp = rules.growth.levelXp[1] - rules.particles.quark.xp;
  const victim = target(99, 180, 150, 1);
  g.targets.push(victim);
  g.damageTarget(victim, 5);
  assert.equal(cards(g)[0].id, 'recover');
  assert.equal(g.growth.automaticCard!.id, 'recover');
});

test('automatic choice: early power or rate, then rarity; an evolution first, a pact only with margin', () => {
  const g = firstOffer(5),
    auto = () => g.growth.automaticCard!.id;
  offer(g, { id: 'multi', rarity: 'legendary' }, { id: 'rate', rarity: 'common' });
  assert.equal(auto(), 'rate');
  g.growth.boosts.rate = rules.growth.autoStatRank;
  assert.equal(auto(), 'multi');
  offer(g, { id: 'range', rarity: 'common' }, { id: 'overheat', rarity: 'common' });
  atMargin(g, o.autoPactMargin);
  assert.equal(auto(), 'range');
  atMargin(g, o.autoPactMargin + 1);
  assert.equal(auto(), 'overheat');
  g.growth.ranks.multi = rules.growth.maxRank;
  cards(g).push({ id: 'multi', rarity: 'rare', evolve: true });
  assert.equal(g.growth.automaticCard!.evolve, true);
});

test('stale numbers and unknown cards are ignored; a pick is recorded for replay', () => {
  const g = firstOffer(7),
    { number } = g.growth.choice!,
    id = cards(g)[0].id;
  assert.equal(g.choose(id, number + 1), false);
  assert.equal(g.choose('luck', number), false);
  assert.equal(g.choose(id, number), true);
  assert.equal(g.growth.rank(id), 1);
  assert.deepEqual(g.inputs.at(-1), { tick: g.elapsedTicks, kind: 'card', id, number });
});

test('all sixteen skills rise to rank 5 and no further', () => {
  for (const id of skillIds) {
    const g = fixture();
    for (let number = 1; number <= 6; number++) {
      offer(g, { id, rarity: 'common' });
      assert.equal(g.choose(id, number), number <= rules.growth.maxRank, `${id} pick ${number}`);
    }
    assert.equal(g.growth.ranks[id], rules.growth.maxRank, id);
  }
});

test('a rank-5 skill is offered its evolution only when the roll lands under the chance', () => {
  const chance = evolutionChance(0, rules),
    miss = levelled({ multi: 5 }, chance);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(evolutions(miss), [], `offer ${miss.growth.choice!.number}`);
    takePlain(miss);
  }
  const hit = levelled({ multi: 5 }, chance - 1e-6);
  assert.deepEqual(evolutions(hit), [{ id: 'multi', rarity: 'common', evolve: true }]);
  assert.equal(cards(hit)[0].evolve, true, 'the evolution leads without a recover card');
  assert.equal(hit.choose('multi', hit.growth.choice!.number), true);
  assert.equal(hit.growth.evolved.multi, true);
  assert.equal(hit.growth.ranks.multi, rules.growth.maxRank);
  assert.equal(hit.growth.selections.at(-1)!.evolve, true);
  assert.equal(logged(hit, 'evolve')[0].data.id, 'multi');
  assert.deepEqual(evolutions(hit), [], 'an evolved skill is not offered again');
});

test('luck raises the evolution chance but never above maxChance', () => {
  const e = rules.growth.evolution,
    lucky = (g: Game) => (g.growth.boosts.luck = 1000);
  assert.equal(evolutionChance(0, rules), e.chance);
  assert.equal(evolutionChance(1000, rules), e.maxChance);
  const capped = levelled({ chain: 5 }, e.maxChance, 1, lucky);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(evolutions(capped), []);
    takePlain(capped);
  }
  assert.equal(evolutions(levelled({ chain: 5 }, e.maxChance - 1e-6, 1, lucky)).length, 1);
});

test('a pact replaces the last card every interval, never beside an evolution or in danger', () => {
  const ranks = { multi: 5, chain: 1 },
    due = levelled(ranks, 0.5, interval);
  assert.ok(isPact(cards(due).at(-1)!.id), JSON.stringify(cards(due)));
  assert.equal(pacts(levelled(ranks, 0.5, interval - 1)), 0);
  assert.equal(pacts(levelled(ranks, 0.5, 2 * interval)), 1);
  const evolving = levelled(ranks, evolutionChance(0, rules) / 2, interval);
  assert.equal(evolutions(evolving).length, 1);
  assert.equal(pacts(evolving), 0, JSON.stringify(cards(evolving)));
  const danger = levelled(ranks, 0.5, interval, (g) => atMargin(g, o.dangerMargin - 1));
  assert.equal(pacts(danger), 0, 'in danger');
  assert.equal(pacts(levelled({ multi: 1 }, 0.5, interval)), 0, 'fewer than minSkills skills');
});

test('a pact is taken once, logged, and the pact limit holds', () => {
  const g = fixture({ multi: 1, chain: 1 }),
    max = rules.growth.pacts.max;
  for (const [i, id] of pactIds.entries()) {
    offer(g, { id, rarity: 'common' });
    assert.equal(g.choose(id, g.growth.choice!.number), i < max, id);
  }
  assert.equal(g.growth.pactCount, max);
  assert.deepEqual(
    logged(g, 'pact').map((e) => e.data.id),
    pactIds.slice(0, max),
  );
  assert.equal(g.growth.rank(pactIds[0]), 1);
});
