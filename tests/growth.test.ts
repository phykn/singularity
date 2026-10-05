import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/model.ts';
import { Random } from '../src/game/random.ts';
import { eligibleUpgrades, makeCards } from '../src/game/growth.ts';
import {
  blankBoosts,
  blankRanks,
  isSkill,
  rarityIds,
  rollRarity,
  rules,
  skillIds,
  statIds,
  upgradeIds,
  levelForXp,
  xpForLevel,
} from '../src/game/rules.ts';
import type { Boosts, UpgradeId } from '../src/game/rules.ts';
import { effectOrigin, visibleEffects } from '../src/render/effects.ts';
import { close, fixture, choose } from './helpers.ts';

test('every skill and stat upgrade confirms its actual rank and follows the live electron', () => {
  for (const id of upgradeIds) {
    const g = new Game(17, { combat: false });
    g.start();
    for (let rank = 1; rank <= 2; rank++) {
      if (id === 'recover') g.mass = 150;
      g.choice = {
        number: rank,
        opened: g.time,
        deadline: g.time + 8,
        cards: [{ id, rarity: 'rare' }],
      };
      assert.ok(g.select(id));
      const fx = visibleEffects(g.effects).find((fx) => fx.kind === 'upgrade');
      assert.ok(fx);
      assert.equal(fx.source, id);
      assert.equal(fx.rank, id === 'recover' ? 0 : rank);
      assert.equal(fx.rarity, 'rare');
      assert.equal(g.notice, id);
      g.advance(50);
      assert.deepEqual(
        effectOrigin(fx, g.position),
        id === 'recover' ? { x: 180, y: 260 } : g.position,
      );
      assert.notDeepEqual(g.position, fx.from);
    }
    g.advance(2100);
    assert.ok(g.time >= g.noticeUntil);
    assert.ok(!g.effects.some((fx) => fx.kind === 'upgrade'));
  }
});

test('energy grants opportunities without automatic speed, fire rate or damage', () => {
  const g = fixture();
  const initial = [g.speed, g.damage, g.attackInterval];
  g.debugSetXp(2000);
  assert.deepEqual([g.speed, g.damage, g.attackInterval], initial);
  assert.equal(g.level, 1 + rules.levelXp.filter((xp) => xp <= 2000).length);
  assert.equal(g.choice?.number, 1);
  assert.ok(g.choice!.cards.every((c) => isSkill(c.id)));
  assert.ok(g.select(g.choice!.cards[0].id));
  assert.equal(g.level, 1 + rules.levelXp.filter((xp) => xp <= 2000).length);
  assert.deepEqual([g.speed, g.damage, g.attackInterval], initial);
});

test('XP thresholds continue beyond level 26 with exact boundaries and carried progress', () => {
  for (const level of [2, 26, 27, 30, 50, 100, 1000, 1000000]) {
    const xp = xpForLevel(level);
    assert.equal(levelForXp(xp - 1), level - 1);
    assert.equal(levelForXp(xp), level);
    assert.equal(levelForXp(xp + 1), level);
  }
  assert.equal(xpForLevel(27), 19080);
  assert.equal(xpForLevel(28), 20620);
  const g = fixture();
  g.debugSetXp(xpForLevel(50) + 17);
  assert.equal(g.level, 50);
  assert.equal(g.levelProgress.current, 17);
  assert.equal(g.levelProgress.required, xpForLevel(51) - xpForLevel(50));
});

test('maxed skills leave three repeatable stat choices and upgrades work above rank five', () => {
  const g = fixture({ burst: 5, repeat: 5, chain: 5, pierce: 5 });
  for (const rank of [5, 20, 100]) {
    g.boosts = { power: rank, rate: rank, range: rank, speed: rank };
    for (const danger of [false, true]) {
      const cards = makeCards(
        { ranks: g.ranks, boosts: g.boosts, number: 100, danger, recoverable: danger },
        new Random(42),
      );
      if (danger) assert.equal(cards[0], 'recover');
      else assert.ok(cards.every((id) => statIds.includes(id as (typeof statIds)[number])));
      assert.equal(cards.length, 3);
    }
    const before = [g.damage, g.rate, g.range, g.speed];
    statIds.forEach((id) => choose(g, id));
    assert.deepEqual(
      statIds.map((id) => g.boosts[id]),
      [rank + 1, rank + 1, rank + 1, rank + 1],
    );
    [g.damage, g.rate, g.range, g.speed].forEach((value, i) => assert.ok(value > before[i]));
    assert.deepEqual(g.ranks, { ...blankRanks(), burst: 5, repeat: 5, chain: 5, pierce: 5 });
  }
});

test('XP alone levels up immediately, carries overflow, queues cards, and pauses every timer', () => {
  const g = fixture();
  g.debugSetXp(rules.levelXp.at(-1)! + 3);
  const initial = structuredClone(g.choice);
  g.setManualPause(true);
  g.advance(20000);
  assert.deepEqual(g.choice, initial);
  assert.equal(g.select(g.choice!.cards[0].id), false);
  g.setHidden(true);
  g.setManualPause(false);
  g.advance(10000);
  assert.equal(g.time, 0);
  g.setManualPause(true);
  g.setHidden(false);
  g.advance(10000);
  assert.equal(g.time, 0);
  g.setManualPause(false);
  g.advance(8000);
  assert.equal(g.level, rules.levelXp.length + 1);
  assert.equal(g.selections.length, 1);
  assert.equal(g.choice?.number, 2);
  assert.equal(g.xp, rules.levelXp.at(-1)! + 3);
  g.advance((rules.levelXp.length - 1) * 8000);
  assert.equal(g.selections.length, rules.levelXp.length);
  assert.equal(g.choice, null);
  assert.deepEqual(
    g.selections.map((s) => s.time),
    Array.from({ length: rules.levelXp.length }, (_, i) => (i + 1) * 8),
  );
  assert.equal(g.xp, rules.levelXp.at(-1)! + 3);
  const empty = fixture();
  empty.advance(100000);
  assert.equal(empty.selections.length, 0);
  assert.equal(empty.choice, null);
  const boundary = fixture();
  boundary.debugSetXp(rules.levelXp[0] - 1);
  boundary.advance(100000);
  assert.equal(boundary.level, 1);
  assert.equal(boundary.choice, null);
  boundary.debugSetXp(rules.levelXp[0]);
  assert.equal(boundary.level, 2);
  assert.equal(boundary.choice?.number, 1);
  assert.deepEqual(boundary.levelProgress, {
    current: 0,
    required: rules.levelXp[1] - rules.levelXp[0],
  });
  boundary.select(boundary.choice!.cards[0].id);
  boundary.debugSetXp(rules.levelXp[1] + 3);
  assert.equal(boundary.choice?.number, 2);
  assert.deepEqual(boundary.levelProgress, {
    current: 3,
    required: rules.levelXp[2] - rules.levelXp[1],
  });
});

test('all skill-rank combinations keep three legal cards even with maxed skills', () => {
  let states = 0,
    minimum = Infinity;
  const ids = ['burst', 'repeat', 'chain', 'pierce'] as const,
    base = rules.maxRank + 1;
  for (let bits = 0; bits < base ** ids.length; bits++) {
    let n = bits,
      spent = 0;
    const ranks = blankRanks();
    for (const id of ids) {
      ranks[id] = n % base;
      n = Math.floor(n / base);
      spent += ranks[id];
    }
    for (let power = 0; power < base; power++)
      for (let rate = 0; rate < base; rate++)
        for (let range = 0; range < base; range++) {
          const sum = spent + power + rate + range;
          const boosts: Boosts = { power, rate, range, speed: 0 };
          const danger = sum % 2 === 0;
          const eligible = eligibleUpgrades(ranks, rules, danger);
          const cards = makeCards(
            { ranks, boosts, number: sum + 1, danger, recoverable: danger },
            new Random(9),
          );
          assert.equal(cards.length, 3);
          assert.equal(new Set(cards).size, 3);
          cards.forEach((id) => assert.ok(eligible.includes(id)));
          if (sum && danger) assert.equal(cards[0], 'recover');
          if (sum && eligible.some(isSkill) && eligible.some((id) => !isSkill(id))) {
            assert.ok(cards.some(isSkill));
            assert.ok(cards.some((id) => !isSkill(id)));
          }
          minimum = Math.min(minimum, eligible.length);
          states++;
        }
  }
  assert.ok(states > 250000);
  assert.equal(minimum, statIds.length);
});

test('stale, double and expired card inputs cannot alter the next choice', () => {
  const g = fixture();
  g.debugSetXp(2000);
  const choice = g.choice!;
  assert.ok(g.select(choice.cards[0].id, false, choice.number));
  assert.equal(g.select(choice.cards[0].id, false, choice.number), false);
  g.advance(25000);
  assert.ok(g.choice);
  assert.equal(g.select(g.choice!.cards[0].id, false, choice.number), false);
  g.advance(8000);
  assert.equal(g.selections.at(-1)?.automatic, true);
});

test('every lightning form can be offered from the first choice without a growth class', () => {
  const opening = new Set<UpgradeId>(),
    later = new Set<UpgradeId>();
  for (let seed = 0; seed < 512; seed++) {
    const random = new Random(seed),
      ranks = blankRanks(),
      boosts = blankBoosts();
    const cards = makeCards(
      { ranks, boosts, number: 1, danger: false, recoverable: false },
      random,
    );
    cards.forEach((id) => opening.add(id));
    ranks.repel = 1;
    makeCards({ ranks, boosts, number: 2, danger: false, recoverable: true }, random).forEach(
      (id) => later.add(id),
    );
  }
  assert.deepEqual(opening, new Set(skillIds));
  assert.deepEqual(later, new Set(upgradeIds));
  for (const id of skillIds) {
    const game = fixture();
    choose(game, id);
    assert.equal(game.rank(id), 1);
  }
});

test('automatic choices pick the highest rarity, including the opening, with stable ties', () => {
  for (const seed of [1710, ...Array.from({ length: 128 }, (_, i) => i)]) {
    const game = new Game(seed, { combat: false });
    game.start();
    game.debugSetXp(rules.levelXp[0]);
    const cards = game.choice!.cards;
    const best = cards.reduce((a, b) =>
      rarityIds.indexOf(b.rarity) > rarityIds.indexOf(a.rarity) ? b : a,
    );
    assert.deepEqual(game.automaticCard, best);
    game.advance(rules.choiceSeconds * 1000);
    assert.equal(game.selections[0].id, best.id);
    assert.equal(game.selections[0].automatic, true);
  }
  const game = fixture();
  game.choice = {
    cards: [
      { id: 'power', rarity: 'common' },
      { id: 'speed', rarity: 'legendary' },
      { id: 'range', rarity: 'legendary' },
    ],
    number: 1,
    opened: 0,
    deadline: 8,
  };
  assert.equal(game.automaticCard?.id, 'speed');
});

test('rarity roll boundaries and seeded base frequencies match published odds', () => {
  let edge = 0;
  for (const id of rarityIds) {
    assert.equal(rollRarity(edge / 100), id);
    edge += rules.rarity[id].chance;
    assert.equal(rollRarity((edge - 0.00001) / 100), id);
  }
  const random = new Random(3189),
    counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (let i = 0; i < 100000; i++) counts[rollRarity(random.next())]++;
  for (const id of rarityIds) close(counts[id] / 1000, rules.rarity[id].chance, 0.5);
});

test('new runs have sixteen lightning skills and always offer owned upgrades', () => {
  assert.equal(skillIds.length, 16);
  const g = fixture();
  g.debugSetXp(18);
  for (let seed = 0; seed < 128; seed++) {
    for (const danger of [false, true]) {
      const ranks = { ...blankRanks(), strike: 2, focus: 1 },
        boosts = blankBoosts();
      const cards = makeCards(
        { ranks, boosts, number: 8, danger, recoverable: danger },
        new Random(seed),
      );
      assert.equal(cards.length, new Set(cards).size);
      assert.ok(cards.some((id) => id === 'strike' || id === 'focus'));
    }
  }
});
