import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import { isSkill, rarityIds, rules, skillIds, xpForLevel } from '../src/game/rules.ts';
import { choose } from './helpers.ts';

test('every skill keeps its first selected rarity through manual and automatic rank upgrades', () => {
  for (const id of skillIds) {
    for (const rarity of rarityIds) {
      const game = new Game(42, { combat: false });
      game.start();
      choose(game, id, rarity);
      for (let rank = 2; rank <= rules.maxRank; rank++) {
        game.choice = {
          number: rank,
          opened: game.time,
          deadline: game.time + 8,
          cards: [{ id, rarity: rarityIds[(rank - 2) % rarityIds.length] }],
        };
        assert.ok(game.select(id, rank % 2 === 0));
        assert.equal(game.ranks[id], rank);
        assert.equal(game.rarities[id], rarity);
        assert.equal(game.selections.at(-1)?.rarity, rarity);
        assert.equal(game.effects.at(-1)?.rarity, rarity);
      }
    }
  }
});

test('owned skill cards always offer the acquired rarity, including common', () => {
  let offers = 0;
  for (let seed = 0; seed < 40; seed++) {
    const game = new Game(seed, { combat: false });
    game.start();
    game.debugSetXp(xpForLevel(30));
    while (game.choice) {
      for (const card of game.choice.cards) {
        if (!isSkill(card.id) || !game.ranks[card.id]) continue;
        offers++;
        assert.equal(card.rarity, game.rarities[card.id]);
      }
      const selected = game.choice.cards.find((c) => isSkill(c.id)) ?? game.choice.cards[0];
      game.select(selected.id);
    }
  }
  assert.ok(offers > 100);
});

test('passing a common offer leaves the skill free to return at a higher rarity', () => {
  let acquired = false;
  for (let seed = 0; seed < 40 && !acquired; seed++) {
    const game = new Game(seed, { combat: false });
    game.start();
    game.debugSetXp(xpForLevel(50));
    const skipped = game.choice!.cards.find((card) => card.rarity === 'common');
    if (!skipped || !isSkill(skipped.id)) continue;
    game.select(game.choice!.cards.find((card) => card.id !== skipped.id)!.id);
    while (game.choice) {
      assert.equal(game.ranks[skipped.id], 0);
      const later = game.choice.cards.find(
        (card) => card.id === skipped.id && card.rarity !== 'common',
      );
      if (later) {
        game.select(later.id);
        assert.equal(game.rarities[skipped.id], later.rarity);
        acquired = true;
        break;
      }
      game.select(game.choice.cards.find((card) => !isSkill(card.id))!.id);
    }
  }
  assert.ok(acquired);
});

test('stat rarities can still improve and each mass vent has its own rarity', () => {
  const game = new Game(42, { combat: false });
  game.start();
  for (const id of ['power', 'rate', 'range', 'speed'] as const) {
    choose(game, id, 'common');
    choose(game, id, 'legendary');
    choose(game, id, 'rare');
    assert.equal(game.rarities[id], 'legendary');
  }
  for (const rarity of ['legendary', 'common'] as const) {
    game.mass = 150;
    choose(game, 'recover', rarity);
    assert.equal(game.rarities.recover, rarity);
  }
});

test('new saves replay first-pick rarities, manual choices and future combat exactly', () => {
  for (const seed of [17, 10004, 96057]) {
    const game = new Game(seed);
    game.start();
    while (game.seconds < 75 && game.phase === 'running') {
      game.advance(1000 / 60);
      if (game.choice) game.select(game.choice.cards[1].id);
    }
    const checkpoint = createCheckpoint(game)!;
    assert.equal('version' in checkpoint, false);
    const restored = restoreCheckpoint(checkpoint)!;
    assert.ok(restored);
    assert.deepEqual(restored.rarities, game.rarities);
    assert.deepEqual(restored.events, game.events);
    assert.deepEqual(restored.choice, game.choice);
    for (const id of skillIds) {
      const picks = game.selections.filter((s) => s.id === id);
      assert.ok(picks.every((s) => s.rarity === picks[0].rarity));
    }
    game.advance(610000);
    restored.advance(610000);
    assert.deepEqual(restored.result, game.result);
    assert.deepEqual(restored.events, game.events);
  }
});
