import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/model.ts';
import { timedSkills } from '../src/game/combat.ts';
import { blankRanks, rarityIds, rules, skillIds, maxDamageNumbers } from '../src/game/rules.ts';
import { effectOrigin, visibleEffects } from '../src/render/effects.ts';
import { close, choose, stationarySkill, target } from './helpers.ts';
import { distance } from '../src/game/geometry.ts';

test('the roster has exactly sixteen current skills and no removed attack forms', () => {
  assert.equal(skillIds.length, 16);
  for (const id of ['area', 'whip', 'wave']) assert.ok(!(id in blankRanks()));
});

test('repeat is weaker, retains its cast damage and rarity, and retargets a dead primary', () => {
  const p = target(0, 210, 128, 100),
    g = stationarySkill({ repeat: 2 }, [p]);
  const damage = g.damage;
  g.combat.fireBasic();
  g.boosts.power = 10;
  g.rarities.repeat = 'legendary';
  g.advance(300);
  close(100 - p.hp, damage * (1 + 2 * rules.skills.repeat.damage));
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 3);
  assert.ok(g.damageNumbers.slice(1).every((n) => n.value < g.damageNumbers[0].value));
  const h = stationarySkill({ repeat: 1 }, [target(0, 190, 128, 1), target(1, 220, 128, 100)]);
  h.combat.fireBasic();
  h.advance(150);
  assert.equal(h.xp, 1);
  assert.ok(h.targets[0].hp < 100);
});

test('fork preserves its primary hit while additional branches share power', () => {
  const ts = [target(0, 190, 128, 100), target(1, 215, 128, 100)];
  const g = stationarySkill({ multi: 1 }, ts);
  g.combat.fireBasic();
  close(100 - ts[0].hp, g.damage);
  assert.ok(ts[1].hp < 100 && ts[1].hp > ts[0].hp);
});

test('chain attenuates at each hop, does not revisit enemies and respects gaps', () => {
  const ts = [0, 40, 80, 120, 240].map((x, i) => target(i, 190 + x, 128, 100));
  const g = stationarySkill({ chain: 3 }, ts);
  g.combat.fireBasic();
  assert.ok(ts[0].hp < ts[1].hp && ts[1].hp < ts[2].hp && ts[2].hp < ts[3].hp);
  assert.equal(ts[4].hp, 100);
  assert.equal(g.damageNumbers.length, 4);
});

test('pierce has a narrow inclusive boundary and never duplicates its primary damage', () => {
  const w = rules.skills.pierce.widths[1] / 2;
  const ts = [
    target(0, 190, 128, 100),
    target(1, 240, 128 + w, 100),
    target(2, 240, 128 + w + 0.01, 100),
  ];
  const g = stationarySkill({ pierce: 1 }, ts);
  g.combat.fireBasic();
  close(100 - ts[0].hp, g.damage);
  assert.ok(ts[1].hp < 100);
  assert.equal(ts[2].hp, 100);
  assert.equal(g.damageNumbers.length, 2);
});

test('strike selects high HP without a splash hit on a neighboring enemy', () => {
  const low = target(0, 200, 128, 10),
    high = target(1, 202, 128, 100);
  const g = stationarySkill({ strike: 1 }, [low, high]);
  g.combat.fireSkill('strike');
  assert.equal(low.hp, 10);
  assert.ok(high.hp < 100);
  assert.equal(g.effects.find((f) => f.kind === 'strike')!.radius, 0);
});

test('focus ramps while holding a target and resets on retarget without slowing it', () => {
  const p = target(0, 210, 128, 1000),
    q = target(1, 235, 128, 1000);
  const g = stationarySkill({ focus: 3 }, [p, q]);
  g.combat.fireSkill('focus');
  g.advance(450);
  const hits = g.damageNumbers.map((d) => d.value);
  assert.ok(hits[2] > hits[1] && hits[1] > hits[0]);
  assert.equal(g.combat.movementScale(p), 1);
  g.damageTarget(p, 10000);
  g.advance(200);
  close(g.damageNumbers.at(-1)!.value, hits[0]);
});

test('repulsion prioritizes inner enemies and repeated pulses cannot repeatedly shove them', () => {
  const p = target(0, 220, 160, 1000),
    q = target(1, 240, 145, 1000),
    g = stationarySkill({ repel: 1, repeat: 3 }, [p, q]);
  const radius = p.radius;
  g.combat.fireSkill('repel');
  const pushed = p.radius;
  assert.ok(pushed > radius);
  g.advance(500);
  close(p.radius, pushed);
  g.advance(1200);
  g.combat.fireSkill('repel');
  assert.ok(p.radius - pushed < pushed - radius);
});

test('gather brings outer enemies together without moving anyone inward toward the core', () => {
  const ts = [target(0, 200, 128, 100), target(1, 235, 140, 100), target(2, 165, 143, 100)];
  const g = stationarySkill({ gather: 3 }, ts),
    radii = ts.map((t) => t.radius),
    before = distance(ts[0], ts[1]);
  g.combat.fireSkill('gather');
  assert.ok(distance(ts[0], ts[1]) < before);
  ts.forEach((t, i) => assert.ok(t.radius >= radii[i] - 1e-8));
});

test('orbs travel and fork; their emitted lightning carries charge and chain modifiers', () => {
  const ts = Array.from({ length: 6 }, (_, i) => target(i, 210 + i * 16, 115 + i * 4, 1000));
  const g = stationarySkill({ orb: 3, multi: 1, chain: 1, charge: 1 }, ts);
  g.combat.fireSkill('orb');
  g.advance(500);
  assert.ok(g.targets.some((t) => (t.charge ?? 0) > 0));
  assert.ok(g.effects.some((f) => f.kind === 'orb' && f.from.x > g.position.x));
  assert.ok(g.combat.activations.multi !== undefined && g.combat.activations.chain !== undefined);
  const ids = new Set(g.effects.filter((f) => f.kind === 'orb').map((f) => f.targetId));
  assert.equal(ids.size, 2);
});

test('charge only releases after enough weighted hits and cannot charge its own discharge', () => {
  const p = target(0, 200, 128, 10000),
    g = stationarySkill({ charge: 1 }, [p]);
  for (let i = 0; i < 4; i++) g.combat.fireBasic();
  assert.equal(g.combat.activations.charge, undefined);
  assert.equal(p.charge, 4);
  g.combat.fireBasic();
  assert.ok(g.combat.activations.charge !== undefined);
  assert.equal(p.charge, 0);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 6);
  const h = stationarySkill({ charge: 1, repeat: 1 }, [target(0, 200, 128, 10000)]);
  h.combat.fireBasic();
  h.advance(150);
  assert.ok(h.targets[0].charge! > 1 && h.targets[0].charge! < 2);
});

test('bridge persists at impact sites, damages a crossing once and expires', () => {
  const a = target(0, 190, 128, 1000),
    b = target(1, 250, 128, 1000),
    c = target(2, 220, 152, 1000);
  const g = stationarySkill({ bridge: 1 }, [a, b, c]);
  g.combat.fireBasic(a);
  g.combat.fireBasic(b);
  Object.assign(c, target(2, 220, 128, 1000));
  g.advance(20);
  assert.ok(c.hp < 1000);
  const hp = c.hp;
  g.advance(100);
  close(c.hp, hp);
  assert.ok(g.effects.some((f) => f.kind === 'bridge'));
  g.advance(1500);
  assert.equal(g.combat.status('bridge').active, false);
});

test('stun stops radial and angular motion, then immunity permits movement during repeat hits', () => {
  const p = target(0, 210, 128, 1000);
  p.speed = 10;
  p.turn = 0.2;
  const g = stationarySkill({ stun: 1, repeat: 5 }, [p]);
  g.combat.fireBasic();
  const before = [p.angle, p.radius];
  g.advance(100);
  assert.deepEqual([p.angle, p.radius], before);
  g.advance(550);
  assert.ok(p.radius < before[1]);
  assert.equal(g.combat.movementScale(p), 1);
  assert.equal(
    g.events.filter((e) => e.kind === 'skill-effect' && (e.data as { id: string }).id === 'stun')
      .length,
    1,
  );
});

test('chase only seeks wounded enemies and does not execute healthy ones', () => {
  const a = target(0, 200, 128, 100),
    b = target(1, 230, 128, 100);
  b.hp = 20;
  const g = stationarySkill({ chase: 1 }, [a, b]);
  g.combat.fireSkill('chase');
  assert.equal(a.hp, 100);
  assert.ok(b.hp < 20);
});

test('chase finishes the weakest wounded enemy before a healthier enemy closer to the core', () => {
  const inner = target(0, 205, 160, 100),
    outer = target(1, 225, 128, 100);
  inner.hp = 20;
  outer.hp = 3;
  const g = stationarySkill({ chase: 1 }, [inner, outer]);
  g.combat.fireSkill('chase');
  assert.equal(inner.hp, 20);
  assert.ok(outer.hp <= 0);
});

test('fork never discounts the first on-kill discharge', () => {
  const g = stationarySkill({ burst: 1, multi: 5 }, [
    target(0, 190, 128, 1),
    target(1, 230, 128, 1000),
  ]);
  g.combat.fireBasic();
  const hits = g.events.filter((e) => e.kind === 'hit' && (e.data as { id: number }).id === 1);
  close((hits[0].data as { damage: number }).damage, g.damage * g.forms.burst.damage);
});

test('surge charges from recent kills and cannot recharge itself while active', () => {
  const g = stationarySkill({ surge: 1 }, []),
    kill = (id: number) => {
      const p = target(id, 200, 128, 1);
      g.targets.push(p);
      g.damageTarget(p, 1);
    };
  for (let i = 0; i < g.forms.surge.kills - 1; i++) kill(i);
  assert.equal(g.combat.status('surge').active, false);
  assert.ok(g.combat.status('surge').progress > 0);
  kill(20);
  assert.equal(g.combat.status('surge').active, true);
  for (let i = 21; i < 61; i++) kill(i);
  g.targets.push(target(100, 205, 128, 1000));
  g.advance(300);
  assert.ok(g.targets[0].hp < 1000);
  g.advance(1500);
  assert.equal(g.combat.status('surge').active, false);
  assert.equal(g.combat.status('surge').progress, 0);
  kill(101);
  g.advance(3100);
  assert.equal(g.combat.status('surge').progress, 0);
});

test('return uses the current electron position without teleporting and never returns twice', () => {
  const initial = target(0, 190, 128, 1),
    p = target(1, 251, 194, 100);
  const g = stationarySkill({ return: 2, charge: 1 }, [initial, p]);
  g.combat.fireBasic();
  g.angle = 0;
  const position = { ...g.position };
  g.advance(300);
  assert.deepEqual(g.position, position);
  assert.ok(p.hp < 100);
  assert.ok(p.charge! > 0);
  const returned = g.effects.find((f) => f.kind === 'return')!;
  assert.ok(returned);
  close(returned.from.x, 190);
  g.advance(1000);
  assert.equal(
    g.events.filter((e) => e.kind === 'skill-effect' && (e.data as { id: string }).id === 'return')
      .length,
    1,
  );
});

test('return plus pierce crosses multiple enemies and chain jumps off the return path', () => {
  const a = target(0, 190, 128, 1),
    b = target(1, 230, 171.27868852459017, 100),
    c = target(2, 270, 214.55737704918033, 100),
    d = target(3, 235, 185, 100);
  const g = stationarySkill({ return: 2, pierce: 1, chain: 1 }, [a, b, c, d]);
  g.combat.fireBasic();
  const before = [b.hp, c.hp, d.hp];
  g.angle = 0;
  g.advance(300);
  assert.ok(b.hp < before[0] && c.hp < before[1] && d.hp < before[2]);
});

test('death arcs are bounded per cast, have no invented cooldown and preserve origin', () => {
  const ts = Array.from({ length: 20 }, (_, i) => target(i, 190 + i * 8, 128, 0.5));
  const g = stationarySkill({ burst: 1 }, ts);
  g.combat.fireBasic();
  assert.equal(g.xp, 1 + g.forms.burst.count);
  assert.equal(g.combat.status('burst').mode, 'conditional');
  assert.ok(
    g.effects.filter((f) => f.source === 'burst').every((f) => f.from.x === 190 && !f.anchor),
  );
});

test('visual and damage number quotas never reduce damage, kills or XP', () => {
  const ts = Array.from({ length: 1600 }, (_, id) => target(id, 190 + (id % 100), 128, 0.1));
  const g = stationarySkill({ pierce: 5 }, ts);
  g.combat.fireBasic();
  assert.equal(g.xp, 1600);
  assert.equal(g.targets.length, 0);
  assert.equal(g.damageNumbers.length, maxDamageNumbers);
  assert.ok(g.effects.length <= 160);
  assert.ok(visibleEffects(g.effects, false).some((f) => f.anchor === 'electron'));
});

test('all timed skills expose real progress and preserve it through rate and pause changes', () => {
  for (const id of timedSkills) {
    const g = stationarySkill({}, [target(0, 200, 128, 10000)]);
    choose(g, id);
    g.advance(200);
    const before = g.combat.status(id);
    assert.equal(before.mode, 'timed');
    choose(g, 'rate');
    close(g.combat.status(id).progress, before.progress);
    for (const hidden of [true, false]) {
      hidden ? g.setHidden(true) : g.setManualPause(true);
      const state = structuredClone([g.targets, g.events, g.effects, g.combat.status(id)]);
      g.advance(10000);
      assert.deepEqual([g.targets, g.events, g.effects, g.combat.status(id)], state);
      hidden ? g.setHidden(false) : g.setManualPause(false);
    }
  }
});

test('focus cannot overlap itself even when its cooldown is already ready', () => {
  const g = stationarySkill({}, [target(0, 200, 128, 100000)]);
  g.boosts.rate = 30;
  choose(g, 'focus');
  g.advance(100);
  assert.ok(g.combat.status('focus').active);
  g.advance(300);
  assert.equal(g.combat.status('focus').progress, 1);
  assert.ok(g.events.filter((e) => e.kind === 'hit').length <= 3);
});

test('empty scheduled skills reset readiness without reporting an actual hit', () => {
  const g = stationarySkill({}, []);
  choose(g, 'strike');
  g.advance(1000 / rules.tickRate);
  assert.deepEqual(g.combat.status('strike'), {
    mode: 'timed',
    progress: 0,
    active: false,
    fired: false,
  });
  g.advance(rules.skills.strike.periodSeconds * 500);
  close(g.combat.status('strike').progress, 0.5);
});

test('all ranks and rarities have finite geometry; stronger skills remain within the same slot limit', () => {
  for (const rarity of rarityIds)
    for (const id of skillIds) {
      const g = stationarySkill({}, []);
      for (let rank = 1; rank <= 5; rank++) {
        choose(g, id, rarity);
        assert.ok(JSON.stringify(g.forms).includes('null') === false);
      }
      assert.equal(g.ranks[id], 5);
    }
});

test('combat lightning retains live electron anchors while derived arcs retain world origins', () => {
  const g = new Game(12, { combat: false });
  g.start();
  g.ranks.chain = 1;
  g.targets = [target(0, 200, 128, 100), target(1, 225, 128, 100)];
  g.combat.fireBasic();
  const basic = g.effects.find((f) => f.kind === 'bolt' && !f.source)!,
    chain = g.effects.find((f) => f.source === 'chain')!;
  g.advance(80);
  assert.deepEqual(effectOrigin(basic, g.position), g.position);
  assert.deepEqual(effectOrigin(chain, g.position), chain.from);
});
