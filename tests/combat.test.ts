import test from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/game/rules.ts';
import { target, fixture, choose, stationarySkill } from './helpers.ts';
import { Random } from '../src/game/random.ts';
import { distance } from '../src/game/geometry.ts';

test('reserved repeat visuals retain the cast rank after a skill upgrade', () => {
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
        fx.kind === 'bolt' && fx.source === 'repeat' && fx.rank === 2 && fx.rarity === 'legendary',
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
