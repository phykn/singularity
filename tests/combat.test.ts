import test from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/game/rules.ts';
import { target, fixture, choose, stationarySkill } from './helpers.ts';
import { Random } from '../src/game/random.ts';
import { distance } from '../src/game/geometry.ts';
import { onSegment } from '../src/game/targeting.ts';

test('segment targeting includes exact endpoints and width edges, ignores dead targets, and orders ties by ID', () => {
  const from = { x: 30, y: 40 },
    to = { x: 130, y: 40 };
  const crowd = [
    target(2, 130, 36),
    target(1, 30, 44),
    target(0, 30, 40),
    target(3, 50, 44 + 1e-7),
    target(4, 70, 40, 0),
    target(5, 30 - 1e-7, 40),
    target(6, 130 + 1e-7, 40),
  ];
  const before = structuredClone(crowd);
  assert.deepEqual(
    onSegment(crowd, from, to, 8).map((t) => t.id),
    [0, 1, 2],
  );
  assert.deepEqual(
    onSegment(crowd, to, from, 8).map((t) => t.id),
    [2, 0, 1],
  );
  assert.deepEqual(onSegment(crowd, from, from, 8), []);
  assert.deepEqual(crowd, before);
});

test('owned skills retain acquisition order after later upgrades', () => {
  const game = fixture();
  choose(game, 'orb');
  choose(game, 'chain');
  choose(game, 'orb');
  choose(game, 'repeat');
  assert.deepEqual(game.ownedSkills, ['orb', 'chain', 'repeat']);
  assert.equal(game.rank('orb'), 2);
});

test('reserved repeat visuals retain the cast rank while the acquired rarity stays fixed', () => {
  const g = stationarySkill({ repeat: 1 }, [target(0, 210, 128, 100)]);
  g.combat.fireBasic();
  choose(g, 'repeat', 'legendary');
  g.advance(150);
  const pulse = g.effects.find((fx) => fx.kind === 'bolt' && fx.source === 'repeat');
  assert.ok(pulse);
  assert.equal(pulse.rank, 1);
  assert.equal(pulse.rarity, 'common');
  assert.equal(g.ranks.repeat, 2);
  g.combat.fireBasic();
  g.advance(150);
  assert.ok(
    g.effects.some(
      (fx) =>
        fx.kind === 'bolt' && fx.source === 'repeat' && fx.rank === 2 && fx.rarity === 'common',
    ),
  );
});

test('large shuffled crowds retain nearest-target order, exact range edges and ID ties', () => {
  const random = new Random(7003);
  const origin = { x: 180, y: 128 };
  for (let trial = 0; trial < 20; trial++) {
    const crowd = Array.from({ length: 1000 }, (_, id) =>
      target(id, 40 + random.next() * 280, 10 + random.next() * 240, 10000),
    );
    crowd.push(target(1001, 180 + rules.primaryRange, 128, 10000));
    crowd.push(target(1002, 180 + rules.primaryRange + 1e-7, 128, 10000));
    crowd.push(target(1003, 180, 129, 10000), target(1004, 181, 128, 10000));
    for (let i = crowd.length - 1; i > 0; i--) {
      const other = Math.floor(random.next() * (i + 1));
      [crowd[i], crowd[other]] = [crowd[other], crowd[i]];
    }
    const g = fixture({ multi: 5 }, crowd);
    const expected = [...crowd]
      .filter((t) => distance(t, origin) <= rules.primaryRange)
      .sort((a, b) => distance(a, origin) - distance(b, origin) || a.id - b.id)
      .slice(0, g.forms.multi.count)
      .map((t) => t.id);
    g.combat.fireBasic(origin);
    assert.deepEqual(
      g.events.filter((e) => e.kind === 'hit').map((e) => (e.data as { id: number }).id),
      expected,
    );
  }
  const edge = fixture({ multi: 5 }, [
    target(2, origin.x + rules.primaryRange + 1e-7, origin.y, 10000),
    target(1, origin.x - rules.primaryRange, origin.y, 10000),
    target(0, origin.x + rules.primaryRange, origin.y, 10000),
  ]);
  edge.combat.fireBasic(origin);
  assert.deepEqual(
    edge.events.filter((e) => e.kind === 'hit').map((e) => (e.data as { id: number }).id),
    [0, 1],
  );
});
