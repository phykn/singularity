import test from 'node:test';
import assert from 'node:assert/strict';
import { skillIds, rules } from '../src/game/rules.ts';
import type { SkillId } from '../src/game/rules.ts';
import { visibleEffects } from '../src/render/effects.ts';
import { close, choose, stationarySkill, target } from './helpers.ts';

const emitters = ['strike', 'wave', 'whip', 'focus'] as const;
const modifiers = skillIds.filter((id) => !emitters.includes(id as (typeof emitters)[number]));
const crowd = () => [
  target(0, 190, 128, 1),
  ...Array.from({ length: 12 }, (_, i) =>
    target(i + 1, 198 + (i % 4) * 13, 128 + Math.floor(i / 4) * 12, 10000),
  ),
];

for (let i = 0; i < skillIds.length; i++) {
  for (const b of skillIds.slice(i + 1)) {
    const a = skillIds[i];
    test(`${a} + ${b} cooperate, conserve XP and bound secondary casts`, () => {
      const g = stationarySkill({ [a]: 2, [b]: 2 }, crowd());
      const emitter = emitters.find((id) => id === a || id === b);
      // Burst needs an actual kill, including when Strike prefers a dense target.
      if (emitter === 'strike' && (a === 'burst' || b === 'burst'))
        g.targets.forEach((t) => {
          t.hp = t.maxHp = 1;
        });
      if (emitter === 'focus' && (a === 'burst' || b === 'burst'))
        g.targets[0] = target(0, 190, 160, 1);
      if (emitter) g.combat.fireSkill(emitter);
      else g.combat.fireBasic();
      g.advance(1200);
      assert.ok(g.combat.activations[a] !== undefined, `${a} never activated`);
      assert.ok(g.combat.activations[b] !== undefined, `${b} never activated`);
      assert.equal(g.counts.quark.generated, g.counts.quark.killed + g.targets.length);
      assert.equal(g.xp, g.counts.quark.killed);
      const combos = g.events.filter((e) => e.kind === 'skill-combo');
      if (
        emitters.includes(a as (typeof emitters)[number]) &&
        emitters.includes(b as (typeof emitters)[number])
      )
        assert.equal(combos.length, 1, 'One echo per root cast; echoes never echo again');
      else assert.equal(combos.length, 0);
      assert.ok(g.effects.length <= 160);
      assert.ok(g.damageNumbers.length <= 64);
    });
  }
}

for (const id of emitters) {
  test(`Repeat increases actual ${id} hits and Multi branches its emission`, () => {
    const run = (extra?: SkillId) => {
      const g = stationarySkill({ [id]: 1, ...(extra ? { [extra]: 1 } : {}) }, [
        target(0, 190, 128, 10000),
      ]);
      g.combat.fireSkill(id);
      const effects = g.effects.filter((fx) => fx.source === id).length;
      g.advance(1400);
      return { hits: g.events.filter((e) => e.kind === 'hit').length, effects };
    };
    const solo = run(),
      repeat = run('repeat'),
      multi = run('multi');
    assert.ok(repeat.hits > solo.hits);
    if (id !== 'strike') {
      if (id !== 'focus') assert.equal(multi.effects, solo.effects * 2);
    } else {
      const g = stationarySkill({ strike: 1, multi: 1 }, [
        target(0, 190, 128, 10000),
        target(1, 240, 128, 10000),
      ]);
      g.combat.fireSkill(id);
      assert.equal(g.effects.filter((fx) => fx.source === id).length, 2);
    }
    if (id === 'focus') {
      const g = stationarySkill({ focus: 1, multi: 1 }, [
        target(0, 190, 128, 10000),
        target(1, 220, 128, 10000),
      ]);
      g.combat.fireSkill(id);
      g.advance(20);
      assert.equal(
        new Set(g.effects.filter((fx) => fx.source === id).map((fx) => fx.targetId)).size,
        2,
      );
      assert.equal(
        visibleEffects(g.effects, false).filter((fx) => fx.kind === 'focus').length,
        2,
        'Both branches must reach the renderer',
      );
    }
  });
}

test('Wave pushes survivors outward once; Focus slows only its live reachable lock', () => {
  const p = target(0, 190, 128, 10000),
    g = stationarySkill({ wave: 1 }, [p]);
  const radius = p.radius;
  g.combat.fireSkill('wave');
  g.advance(600);
  close(p.radius, radius + rules.skills.wave.push[1]);
  close(Math.hypot(p.x - 180, p.y - 260), p.radius);
  const inner = target(0, 180, 160, 10000),
    outer = target(1, 190, 128, 10000);
  const h = stationarySkill({ focus: 1 }, [outer, inner]);
  h.combat.fireSkill('focus');
  h.advance(20);
  close(h.combat.movementScale(inner), h.forms.focus.slow);
  close(h.combat.movementScale(outer), 1);
  h.advance(700);
  close(h.combat.movementScale(inner), 1);
});

test('Wave still pushes targets previously hit by its splash, without double damage', () => {
  const targets = [target(0, 190, 128, 10000), target(1, 210, 128, 10000)];
  const before = targets.map((t) => t.radius);
  const g = stationarySkill({ wave: 1, area: 1 }, targets);
  g.combat.fireSkill('wave');
  g.advance(600);
  targets.forEach((t, i) => close(t.radius, before[i] + g.forms.wave.push));
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 2);
});

test('A Focus echo cannot postpone the owned Focus cooldown indefinitely', () => {
  const g = stationarySkill({ strike: 1, focus: 1 }, [target(0, 190, 128, 10000)]);
  g.combat.fireSkill('strike');
  choose(g, 'focus');
  g.combat.learn('focus', 0);
  g.advance(20);
  assert.ok(g.damageNumbers.some((n) => n.value === g.damage * g.forms.focus.damage));
});

test('Combined repeats retain snapshots, pause cleanly and do not continue after combat clear', () => {
  const g = stationarySkill({ strike: 1, repeat: 2, area: 1 }, [target(0, 190, 128, 10000)]);
  g.combat.fireSkill('strike');
  g.ranks.strike = 5;
  g.ranks.area = 5;
  g.rarities.strike = 'legendary';
  g.setManualPause(true);
  const hits = g.events.filter((e) => e.kind === 'hit').length;
  g.advance(1000);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, hits);
  g.setManualPause(false);
  g.advance(100);
  const strike = g.effects.filter((fx) => fx.source === 'strike').at(-1)!;
  assert.equal(strike.rank, 1);
  assert.equal(strike.rarity, 'common');
  g.combat.clear();
  const before = g.events.filter((e) => e.kind === 'hit').length;
  g.advance(300);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, before);
});
