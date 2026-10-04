import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/model.ts';
import { maxDamageNumbers } from '../src/game/rules.ts';
import { effectOrigin, visibleEffects } from '../src/render/effects.ts';
import {
  blankRanks,
  blankRarities,
  formValues,
  rarityIds,
  rules,
  skillIds,
} from '../src/game/rules.ts';
import { close, target, fixture, choose, stationarySkill } from './helpers.ts';
import { Random } from '../src/game/random.ts';
import { distance } from '../src/game/geometry.ts';

test('reserved repeat visuals retain the cast rank after a skill upgrade', () => {
  const g = stationarySkill({ repeat: 1 }, [target(0, 210, 128, 100)]);
  g.combat.fireBasic();
  choose(g, 'repeat', 'legendary');
  g.advance(100);
  const pulse = g.effects.find((fx) => fx.kind === 'bolt' && fx.source === 'repeat');
  assert.ok(pulse);
  assert.equal(pulse.rank, 1);
  assert.equal(pulse.rarity, 'common');
  assert.equal(g.ranks.repeat, 2);
  g.combat.fireBasic();
  g.advance(100);
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

test('a dense area clear conserves every particle and processes deaths in ID order', () => {
  const crowd = Array.from({ length: 1600 }, (_, id) => target(id, 180 + (id % 8), 128 + (id % 8)));
  const g = fixture({ area: 5, multi: 5, repeat: 5, chain: 5 }, crowd.reverse());
  g.combat.fireBasic();
  assert.equal(g.targets.length, 0);
  assert.equal(g.xp, 1600);
  assert.equal(g.counts.quark.killed, 1600);
  assert.deepEqual(
    g.events.filter((e) => e.kind === 'kill').map((e) => (e.data as { id: number }).id),
    Array.from({ length: 1600 }, (_, id) => id),
  );
  g.advance(700);
  assert.equal(g.xp, 1600, 'Reserved repeats do not award dead particles twice');
});

test('area and pierce share one damage hit, boundaries include the edge, and tie order is stable', () => {
  const origin = { x: 180, y: 128 };
  const g = fixture({ area: 1, pierce: 1 }, [target(0, 200, 128, 10), target(1, 220, 128, 10)]);
  g.combat.fireBasic(origin);
  assert.deepEqual(
    g.targets.map((t) => t.hp),
    [8, 8],
  );
  const beam = fixture({ pierce: 1 }, [
    target(0, 190, 128, 10),
    target(1, 210, 134, 10),
    target(2, 210, 134.01, 10),
  ]);
  beam.combat.fireBasic(origin);
  assert.deepEqual(
    beam.targets.map((t) => t.hp),
    [8, 8, 10],
  );
  const edge = fixture({}, [target(1, 272, 128), target(2, 272.01, 128)]);
  edge.combat.fireBasic(origin);
  assert.equal(edge.xp, 1);
  assert.equal(edge.targets[0].id, 2);
  const tie = fixture({}, [target(2, 180, 168), target(1, 220, 128)]);
  tie.combat.fireBasic(origin);
  assert.equal(tie.targets[0].id, 2);
});

test('repeat follows moving targets, keeps reserved damage, and cancels dead primaries', () => {
  const p = target(0, 190, 128, 20);
  p.turn = 0.3;
  const g = fixture({ repeat: 1 }, [p]);
  g.combat.fireBasic();
  const first = g.effects.find((fx) => fx.kind === 'bolt')!;
  g.boosts.power = 3;
  g.ranks.repeat = 3;
  g.ranks.area = 3;
  g.advance(100);
  assert.equal(p.hp, 16);
  const second = g.effects.filter((fx) => fx.kind === 'bolt').at(-1)!;
  close(second.from.x, g.position.x);
  close(second.to.x, p.x);
  assert.notEqual(second.from.x, first.from.x);
  assert.notEqual(second.to.x, first.to.x);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 2);
  const cancelled = fixture({ repeat: 3 }, [target(0, 180, 128), target(1, 215, 128)]);
  cancelled.combat.fireBasic();
  cancelled.advance(300);
  assert.equal(cancelled.xp, 1);
  assert.equal(cancelled.combat.activations.repeat, undefined);
});

test('spread clears a small line, focus damages separated dense enemies faster', () => {
  const origin = { x: 180, y: 128 };
  const line = () => [0, 32, 64, 96, 128, 160].map((x, i) => target(i, origin.x + x, origin.y));
  const heavy = () =>
    [
      [0, 0],
      [0, 70],
      [70, 0],
      [0, -70],
    ].map(([x, y], i) => target(i, origin.x + x, origin.y + y, 16, 'dense'));
  const a = fixture({ area: 3, chain: 3 }, line());
  a.combat.fireBasic(origin);
  const b = fixture({ multi: 3, repeat: 3 }, line());
  b.combat.fireBasic(origin);
  b.advance(300);
  assert.equal(a.xp, 6);
  assert.equal(b.xp, 3);
  const c = fixture({ area: 3, chain: 3 }, heavy());
  c.combat.fireBasic(origin);
  c.advance(300);
  const d = fixture({ multi: 3, repeat: 3 }, heavy());
  d.combat.fireBasic(origin);
  d.advance(300);
  assert.ok(
    d.targets.reduce((sum, t) => sum + t.hp, 0) < c.targets.reduce((sum, t) => sum + t.hp, 0),
  );
});

test('damage numbers show calculated strikes including fractions and lethal overkill, and stop when paused', () => {
  const g = fixture({ repeat: 2 }, [target(0, 190, 128, 10)]);
  g.boosts.power = 1;
  g.rarities.power = 'epic';
  g.combat.fireBasic({ x: 180, y: 128 });
  close(g.targets[0].hp, 10 - 3.45);
  assert.equal(g.damageNumbers[0].value, 3.45);
  g.advance(300);
  assert.equal(g.targets.length, 0);
  assert.deepEqual(
    g.damageNumbers.map((d) => d.value),
    [3.45, 3.45, 3.45],
  );
  assert.equal(g.xp, 1);
  const frozen = structuredClone(g.damageNumbers);
  g.setHidden(true);
  g.advance(10000);
  assert.deepEqual(g.damageNumbers, frozen);
  g.setHidden(false);
  g.advance(800);
  assert.deepEqual(g.damageNumbers, []);
});

test('damage-number limits never reduce area hits, kills or XP', () => {
  const g = fixture(
    { area: 3 },
    Array.from({ length: 100 }, (_, id) => target(id, 190, 128)),
  );
  g.combat.fireBasic({ x: 180, y: 128 });
  assert.equal(g.counts.quark.killed, 100);
  assert.equal(g.xp, 100);
  assert.equal(g.targets.length, 0);
  assert.equal(g.damageNumbers.length, maxDamageNumbers);
  g.mass = 1000;
  g.radius = g.core + 4;
  g.advance(1000 / 60);
  assert.equal(g.phase, 'collapse');
  assert.deepEqual(g.damageNumbers, []);
});

test('basic lightning modifiers change actual hit coverage at each rank', () => {
  const origin = { x: 180, y: 128 };
  const line = (xs: number[], hp = 2) => xs.map((x, id) => target(id, origin.x + x, origin.y, hp));
  for (const rank of [1, 2, 3]) {
    for (const id of ['area', 'burst'] as const) {
      const g = fixture({ [id]: rank }, line([0, 24, 34, 46]));
      g.combat.fireBasic(origin);
      assert.equal(g.xp, rank + 1, id);
    }
    const repeat = fixture({ repeat: rank }, line([0], 8));
    repeat.combat.fireBasic(origin);
    repeat.advance(300);
    assert.equal(repeat.targets[0]?.hp ?? 0, 8 - 2 * (rank + 1));
    const multi = fixture(
      { multi: rank },
      [
        [40, 0],
        [-40, 0],
        [0, 40],
        [0, -40],
      ].map(([x, y], id) => target(id, origin.x + x, origin.y + y)),
    );
    multi.combat.fireBasic(origin);
    assert.equal(multi.xp, rank + 1);
    const chain = fixture({ chain: rank }, line([0, 40, 80, 120, 160, 200]));
    chain.combat.fireBasic(origin);
    assert.equal(chain.xp, [0, 3, 5, 6][rank]);
    const pierce = fixture({ pierce: rank }, line([20, 80, 130, 180, 230]));
    pierce.combat.fireBasic(origin);
    assert.equal(pierce.xp, rank + 2);
  }
});

test('rarity persists through lower-quality upgrades and improves real damage and orbit support', () => {
  const g = fixture({}, [target(0, 190, 128, 20)]);
  choose(g, 'power', 'legendary');
  g.combat.fireBasic();
  close(g.targets[0].hp, 16.2);
  choose(g, 'power', 'common');
  assert.equal(g.rarities.power, 'legendary');
  g.combat.fireBasic();
  close(g.targets[0].hp, 10.6);
  choose(g, 'accel', 'legendary');
  g.mass = 100;
  g.advance(30000);
  close(g.radius, 88.6);
  close(g.speed, 231);
  assert.equal(g.mass, 100);
  g.debugSetXp(10000);
  g.advance(50000);
  for (const card of g.choice?.cards ?? [])
    assert.ok(rarityIds.indexOf(card.rarity) >= rarityIds.indexOf(g.rarities[card.id]));
});

test('all four rarities change actual geometry or hit counts across basic lightning modifiers', () => {
  const origin = { x: 180, y: 128 };
  const line = (xs: number[], hp = 2) => xs.map((x, id) => target(id, origin.x + x, origin.y, hp));
  for (let tier = 0; tier < 4; tier++) {
    const rarity = rarityIds[tier];
    for (const [id, xs] of [
      ['area', [0, 32, 39, 48]],
      ['burst', [0, 26, 32, 40]],
    ] as const) {
      const g = fixture({ [id]: 1 }, line([...xs]));
      g.rarities[id] = rarity;
      g.combat.fireBasic(origin);
      assert.equal(g.xp, tier + 1, id + rarity);
    }
    const repeat = fixture({ repeat: 1 }, line([0], 20));
    repeat.rarities.repeat = rarity;
    repeat.combat.fireBasic(origin);
    repeat.advance(700);
    assert.equal(repeat.targets[0].hp, 20 - (tier + 2) * 2);
    const multi = fixture({ multi: 1 }, line([10, 20, 30, 40, 50]));
    multi.rarities.multi = rarity;
    multi.combat.fireBasic(origin);
    assert.equal(multi.xp, tier + 2);
    const chain = fixture({ chain: 1 }, line([0, 40, 80, 120, 160, 200, 240, 280, 320]));
    chain.rarities.chain = rarity;
    chain.combat.fireBasic(origin);
    assert.equal(chain.xp, 3 + tier * 2);
    const pierce = fixture({ pierce: 1 }, line([20, 150, 190, 240]));
    pierce.rarities.pierce = rarity;
    pierce.combat.fireBasic(origin);
    assert.equal(pierce.xp, tier + 1);
  }
});

test('reserved pulses keep their original rarity geometry', () => {
  const g = fixture({ repeat: 1, area: 1 }, [target(0, 180, 128, 20), target(1, 226, 128, 20)]);
  g.combat.fireBasic();
  g.rarities.repeat = 'legendary';
  g.rarities.area = 'legendary';
  g.advance(700);
  assert.equal(g.targets[0].hp, 16);
  assert.equal(g.targets[1].hp, 20);
});

test('fractional rarity damage resolves exact lethal totals without a phantom last hit', () => {
  const g = fixture({}, [target(0, 180, 128, 16, 'dense')]);
  g.boosts.power = 1;
  g.rarities.power = 'rare';
  for (let i = 0; i < 5; i++) g.combat.fireBasic();
  assert.equal(g.targets.length, 0);
  assert.equal(g.xp, 5);
  const h = fixture({}, [target(0, 180, 128, 44, 'dense')]);
  h.boosts.power = 2;
  h.rarities.power = 'rare';
  for (let i = 0; i < 10; i++) h.combat.fireBasic();
  assert.equal(h.targets.length, 0);
  assert.equal(h.xp, 5);
});

test('ranks four and five improve actual hit coverage for all forms while preserving four slots', () => {
  const origin = { x: 180, y: 128 };
  const line = (xs: number[], hp = 2) => xs.map((x, i) => target(i, origin.x + x, origin.y, hp));
  for (const rank of [4, 5]) {
    for (const [id, xs] of [
      ['area', [0, 60, 76]],
      ['burst', [0, 55, 68]],
    ] as const) {
      const game = fixture({ [id]: rank }, line([...xs]));
      game.combat.fireBasic(origin);
      assert.equal(game.xp, rank === 4 ? 2 : 3);
    }
    const repeat = fixture({ repeat: rank }, line([0], 20));
    repeat.combat.fireBasic(origin);
    repeat.advance(600);
    assert.equal(repeat.targets[0].hp, rank === 4 ? 10 : 8);
    const multi = fixture({ multi: rank }, line([10, 20, 30, 40, 50, 60]));
    multi.combat.fireBasic(origin);
    assert.equal(multi.xp, rank + 1);
    const chain = fixture({ chain: rank }, line(Array.from({ length: 10 }, (_, i) => i * 60)));
    chain.combat.fireBasic(origin);
    assert.equal(chain.xp, rank === 4 ? 8 : 10);
    const pierce = fixture({ pierce: rank }, line([20, 280, 320]));
    pierce.combat.fireBasic(origin);
    assert.equal(pierce.xp, rank === 4 ? 2 : 3);
  }
  const game = fixture();
  game.debugSetXp(rules.levelXp.at(-1)!);
  game.advance(rules.levelXp.length * rules.choiceSeconds * 1000);
  assert.equal(game.level, 26);
  assert.equal(game.selections.length, 25);
  assert.equal(game.choice, null);
  assert.ok(skillIds.filter((id) => game.ranks[id]).length <= 4);
});

test('lightning follows the live electron while chain links keep their hit origins', () => {
  const game = fixture({ chain: 1 }, [target(0, 190, 128, 100), target(1, 218, 128, 100)]);
  game.combat.fireBasic();
  const bolt = game.effects.find((fx) => fx.kind === 'bolt' && !fx.source)!;
  const chain = game.effects.find((fx) => fx.source === 'chain')!;
  game.advance(100);
  assert.notDeepEqual(game.position, bolt.from);
  assert.deepEqual(effectOrigin(bolt, game.position), game.position);
  assert.deepEqual(effectOrigin(chain, game.position), chain.from);
  assert.ok(bolt.life <= 0.14);
});

test('dense kills retain the emitting bolt within the effect budget', () => {
  const game = fixture(
    { area: 5 },
    Array.from({ length: 240 }, (_, i) => target(i, 180 + (i % 20), 128)),
  );
  game.combat.fireBasic();
  assert.equal(game.xp, 240);
  assert.equal(game.effects.length, 160);
  assert.ok(game.effects.some((fx) => fx.kind === 'bolt' && fx.anchor === 'electron'));
});

test('effect display limits preserve emitting lightning while reducing kill and area clutter', () => {
  const game = fixture(
    { area: 5, multi: 5, chain: 5 },
    Array.from({ length: 240 }, (_, i) => target(i, 180 + (i % 20), 128, 4)),
  );
  game.combat.fireBasic();
  const before = { xp: game.xp, targets: game.targets.length, effects: game.effects.length };
  const normal = visibleEffects(game.effects, false),
    reduced = visibleEffects(game.effects, true);
  assert.ok(normal.some((fx) => fx.anchor === 'electron'));
  assert.ok(normal.filter((fx) => fx.kind === 'kill').length <= 10);
  assert.ok(normal.filter((fx) => fx.kind === 'area').length <= 4);
  assert.ok(reduced.filter((fx) => fx.kind === 'kill').length <= 3);
  assert.deepEqual(
    { xp: game.xp, targets: game.targets.length, effects: game.effects.length },
    before,
  );
});

test('death arcs start at the defeated enemy, obey their target limit and never recurse', () => {
  const g = fixture({ burst: 1 }, [
    target(0, 190, 128),
    target(1, 200, 128),
    target(2, 210, 128),
    target(3, 220, 128),
  ]);
  g.combat.fireBasic();
  assert.equal(g.xp, 3);
  assert.equal(g.targets[0].id, 3);
  const arcs = g.effects.filter((fx) => fx.source === 'burst');
  assert.equal(arcs.length, 2);
  assert.ok(arcs.every((fx) => fx.kind === 'bolt' && fx.from.x === 190 && fx.anchor === undefined));
});

test('thunderstrike prioritizes high HP and all five ranks increase struck targets', () => {
  for (let rank = 1; rank <= 5; rank++) {
    const targets = Array.from({ length: 8 }, (_, id) =>
      target(
        id,
        180 + Math.cos((id * Math.PI) / 4) * 120,
        128 + Math.sin((id * Math.PI) / 4) * 120,
        100 + id,
      ),
    );
    const g = fixture({ strike: rank }, targets);
    g.combat.fireSkill('strike');
    assert.equal(g.damageNumbers.length, rank);
    assert.equal(targets[7].hp, 107 - rules.baseHitDamage * rules.skills.strike.damage);
    assert.equal(g.effects.filter((fx) => fx.kind === 'strike').length, rank);
    assert.ok(
      g.effects
        .filter((fx) => fx.kind === 'strike')
        .every((fx) => fx.from.x === fx.to.x && fx.from.y < fx.to.y),
    );
  }
  const g = fixture({ strike: 5 }, [target(0, 190, 128, 100), target(1, 191, 128, 100)]);
  g.combat.fireSkill('strike');
  assert.equal(g.damageNumbers.length, 2);
});

test('shockwaves hit on the expanding front once per enemy and grow at every rank', () => {
  for (let rank = 1; rank <= 5; rank++) {
    const g = fixture(
      { wave: rank },
      [45, 60, 75, 90, 105].map((x, id) => target(id, 180 + x, 128, 100)),
    );
    g.combat.fireSkill('wave');
    g.advance(100);
    assert.equal(g.damageNumbers.length, 0);
    g.advance(400);
    assert.equal(g.damageNumbers.length, rank);
    assert.ok(g.damageNumbers.every((n) => n.value === 3));
    const hits = g.events.filter((e) => e.kind === 'hit').length;
    g.advance(500);
    assert.equal(g.events.filter((e) => e.kind === 'hit').length, hits);
  }
});

test('lightning lashes sweep the live electron arc with one hit per target at every rank', () => {
  for (let rank = 1; rank <= 5; rank++) {
    const targets = [
      target(0, 190, 128, 100),
      ...[0, 40, 55, 70, 85].map((a, id) =>
        target(
          id + 1,
          180 + Math.cos((a * Math.PI) / 180) * 60,
          128 + Math.sin((a * Math.PI) / 180) * 60,
          100,
        ),
      ),
    ];
    const g = stationarySkill({ whip: rank }, targets);
    g.combat.fireSkill('whip');
    g.advance(400);
    assert.equal(g.events.filter((e) => e.kind === 'hit').length, rank + 1);
    assert.ok(g.damageNumbers.every((n) => n.value === 4));
    assert.ok(targets.every((t) => t.hp === 100 || t.hp === 96));
  }
});

test('focused arcs sustain damage, retarget killed enemies and extend duration at every rank', () => {
  for (let rank = 1; rank <= 5; rank++) {
    const g = stationarySkill({ focus: rank }, [target(0, 190, 128, 100)]);
    g.combat.fireSkill('focus');
    g.advance(2200);
    const hits = g.events.filter((e) => e.kind === 'hit');
    assert.equal(
      hits.length,
      Math.ceil(rules.skills.focus.durations[rank] / rules.skills.focus.tickSeconds - 1e-8),
    );
    close(g.targets[0].hp, 100 - hits.length * 3);
  }
  const g = stationarySkill({ focus: 1 }, [target(0, 190, 128, 1), target(1, 210, 128, 100)]);
  g.combat.fireSkill('focus');
  g.advance(600);
  assert.equal(g.xp, 1);
  close(g.targets[0].hp, 94);
});

test('four rarities change new attacks and power changes their actual damage', () => {
  for (let i = 0; i < rarityIds.length; i++) {
    const rarity = rarityIds[i];
    const ranks = { ...blankRanks(), strike: 1, wave: 1, whip: 1, focus: 1 };
    const rarities = {
      ...blankRarities(),
      strike: rarity,
      wave: rarity,
      whip: rarity,
      focus: rarity,
    };
    const f = formValues(ranks, rarities);
    assert.equal(f.strike.count, 1 + i);
    close(f.wave.radius, 50 * rules.rarity[rarity].scale);
    close(f.whip.length, 65 * rules.rarity[rarity].scale);
    const g = stationarySkill({ focus: 1 }, [target(0, 190, 128, 100)]);
    g.rarities.focus = rarity;
    g.boosts.power = 2;
    g.combat.fireSkill('focus');
    g.advance(100);
    close(g.damageNumbers[0].value, 4 * 1.5 * rules.rarity[rarity].scale);
  }
});

test('new skill cooldowns scale with fire rate and every active attack pauses with the game', () => {
  const g = fixture();
  choose(g, 'wave');
  g.advance(1000);
  choose(g, 'rate');
  assert.equal(
    g.events.filter((e) => e.kind === 'skill-effect' && (e.data as { id: string }).id === 'wave')
      .length,
    1,
  );
  g.advance(1340);
  assert.equal(
    g.events.filter((e) => e.kind === 'skill-effect' && (e.data as { id: string }).id === 'wave')
      .length,
    1,
  );
  g.advance(30);
  assert.equal(
    g.events.filter((e) => e.kind === 'skill-effect' && (e.data as { id: string }).id === 'wave')
      .length,
    2,
  );
  for (const id of ['wave', 'whip', 'focus'] as const) {
    const h = stationarySkill({ [id]: 1 }, [target(0, 190, 128, 100)]);
    h.combat.fireSkill(id);
    h.advance(50);
    h.setManualPause(true);
    const before = structuredClone([h.targets, h.events, h.effects, h.damageNumbers]);
    h.advance(5000);
    assert.deepEqual([h.targets, h.events, h.effects, h.damageNumbers], before);
  }
});

test('linked and timed skill fills keep their progress across rate upgrades and both pause sources', () => {
  const g = new Game(42);
  g.start();
  choose(g, 'area');
  choose(g, 'chain');
  choose(g, 'strike');
  g.advance(200);
  const area = g.combat.status('area'),
    strike = g.combat.status('strike');
  assert.equal(area.mode, 'linked');
  assert.equal(strike.mode, 'timed');
  assert.ok(area.progress > 0 && area.progress < 1);
  assert.equal(area.progress, g.combat.status('chain').progress);
  choose(g, 'rate');
  close(g.combat.status('area').progress, area.progress);
  close(g.combat.status('strike').progress, strike.progress);
  for (const hidden of [false, true]) {
    hidden ? g.setHidden(true) : g.setManualPause(true);
    const before = skillIds.map((id) => g.combat.status(id));
    g.advance(8000);
    assert.deepEqual(
      skillIds.map((id) => g.combat.status(id)),
      before,
    );
    hidden ? g.setHidden(false) : g.setManualPause(false);
  }
  g.advance(100);
  assert.ok(g.combat.status('area').progress > area.progress);
  assert.ok(g.combat.status('strike').progress > strike.progress);
});

test('empty scheduled strikes reset their fill without confirming a hit', () => {
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
  const t = target(0, 190, 128, 100);
  g.targets = [t];
  g.advance(rules.skills.strike.periodSeconds * 500);
  assert.ok(t.hp < 100);
  assert.ok(g.combat.status('strike').fired);
  close(g.combat.status('strike').progress, 0);
  g.mass = 1000;
  g.radius = g.core + 4;
  g.advance(1000 / rules.tickRate);
  assert.equal(g.phase, 'collapse');
  assert.equal(g.combat.status('strike').fired, false);
});

test('focused arc can be ready while active, never overlaps itself and only confirms actual pulses', () => {
  const t = target(0, 190, 128, 1000),
    g = stationarySkill({}, [t]);
  g.boosts.rate = 5;
  g.rarities.rate = 'legendary';
  for (let i = 0; i < 5; i++) choose(g, 'focus');
  g.advance(1000 / rules.tickRate);
  assert.ok(g.combat.status('focus').active && g.combat.status('focus').fired);
  close(g.combat.status('focus').progress, 0);
  g.advance(1000);
  assert.ok(g.combat.status('focus').active);
  close(g.combat.status('focus').progress, 1);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 6);
  g.advance(800);
  assert.equal(g.combat.status('focus').active, false);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 9);
  g.advance(1000 / rules.tickRate);
  assert.ok(g.combat.status('focus').active && g.combat.status('focus').fired);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 10);
  const empty = stationarySkill({ focus: 1 }, []);
  empty.combat.fireSkill('focus');
  empty.advance(100);
  assert.ok(empty.combat.status('focus').active);
  assert.equal(empty.combat.status('focus').fired, false);
});

test('death arc has no invented cooldown and flashes only with an actual secondary target', () => {
  const g = stationarySkill({ burst: 1 }, [target(0, 190, 128)]);
  g.combat.fireBasic();
  assert.deepEqual(g.combat.status('burst'), {
    mode: 'conditional',
    progress: 0,
    active: false,
    fired: false,
  });
  g.targets = [target(1, 190, 128), target(2, 200, 128, 100)];
  g.combat.fireBasic();
  assert.equal(g.combat.status('burst').fired, true);
  g.advance(200);
  assert.equal(g.combat.status('burst').fired, false);
});
