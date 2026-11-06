import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { CENTER } from '../src/game/geometry.ts';
import { evolutionChance, isPact, rules, skillIds, xpForLevel } from '../src/game/rules.ts';
import type { SkillId } from '../src/game/rules.ts';
import type { Target } from '../src/game/types.ts';
import { fixture, target } from './helpers.ts';

// Every draw on the cards stream returns `roll`, so the evolution roll lands where a test needs it.
function levelled(ranks: Parameters<typeof fixture>[0], roll: number, luck = 0): Game {
  const g = fixture(ranks);
  g.boosts.luck = luck;
  g['random'].cards.next = () => roll;
  g.xp = xpForLevel(30, rules);
  g['openChoice']();
  return g;
}
// Takes the first card that is no evolution, pact or luck (luck would raise the chance).
function takePlain(g: Game): void {
  const { cards, number } = g.choice!,
    card = cards.find((c) => !c.evolve && !isPact(c.id) && c.id !== 'luck' && g.canUpgrade(c.id));
  assert.ok(card && g.choose(card.id, number), `offer ${number}: ${JSON.stringify(cards)}`);
}
const evolutions = (g: Game) => g.choice!.cards.filter((c) => c.evolve);

test('a rank-5 skill is offered its evolution only when the roll lands under the chance', () => {
  const chance = evolutionChance(0, rules);
  const miss = levelled({ multi: 5 }, chance);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(evolutions(miss), [], `offer ${miss.choice!.number}`);
    takePlain(miss);
  }
  const hit = levelled({ multi: 5 }, chance - 1e-6);
  assert.deepEqual(evolutions(hit), [{ id: 'multi', rarity: 'common', evolve: true }]);
  assert.equal(hit.choice!.cards[0].evolve, true, 'the evolution leads without a recover card');
  assert.equal(hit.choose('multi', hit.choice!.number), true);
  assert.equal(hit.evolved.multi, true);
  assert.equal(hit.ranks.multi, rules.growth.maxRank);
  assert.equal(hit.selections.at(-1)!.evolve, true);
  assert.ok(hit.events.some((e) => e.kind === 'evolve' && e.data.id === 'multi'));
  assert.deepEqual(evolutions(hit), [], 'an evolved skill is not offered again');
});

test('luck raises the evolution chance but never above maxChance', () => {
  const e = rules.growth.evolution;
  assert.equal(evolutionChance(0, rules), e.chance);
  assert.equal(evolutionChance(1000, rules), e.maxChance);
  const capped = levelled({ chain: 5 }, e.maxChance, 1000);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(evolutions(capped), []);
    takePlain(capped);
  }
  assert.equal(evolutions(levelled({ chain: 5 }, e.maxChance - 1e-6, 1000)).length, 1);
});

// The electron sits at the top of the orbit, (180, 128); `hold` keeps it there while time runs.
function hold(g: Game, seconds: number): void {
  for (let i = 0; i < seconds * rules.time.tickRate; i++) {
    g.angle = -Math.PI / 2;
    g.run(1);
  }
}
const grid = (hp: number, columns: number, rows: number, step = 15, first = 0, top = 145) =>
  Array.from({ length: columns * rows }, (_, i) =>
    target(
      first + i,
      180 + ((i % columns) - (columns - 1) / 2) * step,
      top + Math.floor(i / columns) * step,
      hp,
    ),
  );
const ring = (hp: number, count: number, radius: number, first = 0) =>
  Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    return target(first + i, CENTER.x + radius * Math.cos(a), CENTER.y + radius * Math.sin(a), hp);
  });
const kill = (g: Game, t: Target) =>
  g.combat.deal({ power: 10, damage: 10, range: 99, depth: 0, budget: { burst: false } }, t, 10);
const hits = (g: Game) => g.events.filter((e) => e.kind === 'hit').length;

// Each scenario runs on the same fixture with and without the evolution; `measure` reads the
// difference (hits by default).
const scenarios: Record<
  SkillId,
  { targets: () => Target[]; run: (g: Game) => void; measure?: (g: Game) => number }
> = {
  // Kills add Repeat hits.
  repeat: { targets: () => grid(1, 5, 4), run: (g) => (g.combat.fireBasic(), hold(g, 2)) },
  // Fork links its primaries.
  multi: { targets: () => grid(1000, 3, 2), run: (g) => g.combat.fireBasic() },
  // The chain turns back.
  chain: { targets: () => grid(1000, 3, 2, 30), run: (g) => g.combat.fireBasic() },
  // Pierce leaves a trail that keeps hitting.
  pierce: {
    targets: () => [target(0, 180, 150, 1000), target(1, 180, 200, 1000)],
    run: (g) => (g.combat.fireBasic(), hold(g, 1.5)),
  },
  // Particles popped by a discharge discharge again.
  burst: { targets: () => grid(1, 7, 5, 14), run: (g) => g.combat.fireBasic() },
  // Bolts keep falling between strikes.
  strike: {
    targets: () => grid(1000, 3, 2),
    run: (g) => (g.combat.fireSkill('strike'), hold(g, 1.2)),
  },
  // The satellites are joined into a ring.
  satellite: {
    targets: () => grid(1000, 5, 5, 10, 0, 108),
    run: (g) => g.combat.fireSkill('satellite'),
  },
  // A discharge spreads as a ring around the electron.
  charge: {
    targets: () => grid(1000, 3, 2),
    run: (g) => {
      for (let i = 0; i < 3; i++) (g.combat.fireBasic(), hold(g, 0.1));
    },
  },
  // Kills while surging extend it; measured in ticks surging.
  surge: {
    targets: () => grid(1, 4, 3, 15, 0, 400),
    run: (g) => {
      for (let i = 0; i < g.forms.surge.kills + 1; i++) kill(g, g.targets[0]);
    },
    measure: (g) => {
      let ticks = 0;
      for (; g.combat.surging && ticks < 600; ticks++) g.run(1);
      return ticks;
    },
  },
  // The returning bolt bounces back out once more.
  return: {
    targets: () => [target(0, 180, 170, 1000)],
    run: (g) => (g.combat.fireBasic(), hold(g, 1)),
  },
  // A detonation passes fresh marks to neighbours; measured in marked particles.
  mark: {
    targets: () => grid(1000, 5, 4),
    run: (g) => {
      for (const t of g.targets.slice(0, g.forms.mark.threshold)) kill(g, t);
    },
    measure: (g) => g.targets.filter((t) => t.marked).length,
  },
  // The third beat sweeps the whole lap.
  tempo: { targets: () => ring(1e6, 30, 100), run: (g) => (g.resonate(3), g.run(60)) },
  // Each spark bounces once.
  spark: {
    targets: () => grid(1000, 4, 3, 20),
    run: (g) => (g.combat.fireSkill('spark'), hold(g, 1)),
  },
  // Kills leave a remnant field that hits what stayed.
  field: {
    targets: () => grid(1, 3, 2, 30).concat(grid(1000, 3, 2, 30, 10, 155)),
    run: (g) => (g.combat.fireSkill('field'), g.run(60)),
  },
  // Each later split reaches further: B to C is beyond the base radius.
  fission: {
    targets: () => [target(0, 180, 160, 1), target(1, 230, 160, 1), target(2, 302, 160, 1)],
    run: (g) => (g.combat.fireBasic(), g.run(60)),
  },
  // The discharge echoes once.
  overcharge: {
    targets: () => ring(1, 16, 60).concat(ring(1000, 8, 132, 20)),
    run: (g) => {
      for (const t of g.targets.slice(0, g.forms.overcharge.kills)) kill(g, t);
      g.run(60);
    },
  },
};

test('each of the sixteen evolutions changes what its skill does', () => {
  assert.deepEqual(Object.keys(scenarios).sort(), [...skillIds].sort());
  for (const id of skillIds) {
    const { targets, run, measure = hits } = scenarios[id];
    const play = (evolved: boolean) => {
      const g = fixture({ [id]: rules.growth.maxRank }, targets());
      if (evolved) g.evolved[id] = true;
      run(g);
      return measure(g);
    };
    const plain = play(false),
      evolved = play(true);
    assert.ok(evolved > plain, `${id}: evolved ${evolved}, plain ${plain}`);
  }
});
