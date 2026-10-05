import test from 'node:test';
import assert from 'node:assert/strict';
import { skillIds, rules } from '../src/game/rules.ts';
import type { SkillId } from '../src/game/rules.ts';
import { timedSkills } from '../src/game/skills.ts';
import { choose, stationarySkill, target } from './helpers.ts';

// Exercise actual shared hits, geometry and trigger state rather than a hand-written combo table.
for (let a = 0; a < skillIds.length; a++)
  for (let b = a + 1; b < skillIds.length; b++) {
    const ids = [skillIds[a], skillIds[b]];
    test(`${ids.join(' + ')} stay active together, conserve particles and bound reactions`, () => {
      const ts = Array.from({ length: 32 }, (_, i) => {
        const t = target(i, 190 + (i % 8) * 18, 112 + Math.floor(i / 8) * 16, i < 12 ? 1 : 80);
        if (i >= 12 && i % 3 === 0) t.hp = 15;
        return t;
      });
      const g = stationarySkill({}, ts);
      ids.forEach((id) => choose(g, id));
      const original = ts.length + 1;
      for (let tick = 0; tick < 240; tick++) {
        if (tick % 6 === 0) {
          const living = g.targets;
          // Alternate impact sites so single-target pairs can also form a wire.
          const from = living.length ? living[(tick / 6) % living.length] : g.position;
          g.combat.fireBasic(from);
        }
        g.advance(1000 / rules.tickRate);
      }
      const heavy = target(999, 200, 128, 100000);
      g.targets.push(heavy);
      g.counts.quark.generated++;
      for (let i = 0; i < 8; i++) {
        g.combat.fireBasic(heavy);
        g.advance(150);
      }
      for (const id of ids)
        assert.ok(g.combat.activations[id] !== undefined, `${id} never activated`);
      assert.equal(g.xp + g.targets.length + g.counts.quark.absorbed, original);
      assert.ok(
        g.targets.every((t) => Number.isFinite(t.hp) && t.hp > 0 && Number.isFinite(t.radius)),
      );
      assert.ok(g.effects.length <= 160 && g.events.filter((e) => e.kind === 'hit').length < 5000);
    });
  }

for (const id of timedSkills) {
  test(`Repeat and Fork modify ${id} hits without recursive cast duplication`, () => {
    const run = (modifiers: Partial<Record<SkillId, number>>) => {
      const ts = Array.from({ length: 10 }, (_, i) => {
        const t = target(i, 195 + i * 10, 120 + (i % 2) * 14, 10000);
        t.hp = 1000;
        return t;
      });
      const g = stationarySkill({ [id]: 2, ...modifiers }, ts);
      g.combat.fireSkill(id);
      g.advance(1000);
      return { g, damage: ts.reduce((sum, t) => sum + 1000 - t.hp, 0) };
    };
    const base = run({}),
      repeat = run({ repeat: 2 }),
      multi = run({ multi: 2 });
    assert.ok(repeat.damage > base.damage, `${id}: repeated attack did not add damage`);
    assert.ok(multi.damage > base.damage, `${id}: branches did not add coverage`);
    assert.ok(repeat.damage < base.damage * 3, `${id}: weaker follow-ups should not triple damage`);
  });
}

test('mixed charge, death, chain and repeat reactions cannot turn into an unbounded feedback loop', () => {
  const ts = Array.from({ length: 400 }, (_, i) =>
    target(i, 190 + (i % 40), 112 + Math.floor(i / 40) * 4, i % 2 ? 30 : 1),
  );
  const g = stationarySkill({ charge: 5, burst: 5, chain: 5, repeat: 5 }, ts);
  for (let i = 0; i < 8; i++) {
    g.combat.fireBasic();
    g.advance(150);
  }
  g.advance(1500);
  assert.ok(g.events.length < 50000 && g.effects.length <= 160);
  assert.equal(g.xp + g.targets.length, 400);
  const hits = g.events.filter((e) => e.kind === 'hit').length;
  g.advance(4000);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, hits);
});
