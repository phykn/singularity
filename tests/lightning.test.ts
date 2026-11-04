import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.ts';
import { timedSkills } from '../src/game/skills.ts';
import { rarityIds, rules, skillIds, maxDamageNumbers } from '../src/game/rules.ts';
import { effectOrigin, visibleEffects } from '../src/render/effects.ts';
import { close, choose, stationarySkill, target } from './helpers.ts';
import { distance } from '../src/game/geometry.ts';

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

test('strike selects high HP and its splash also hits a neighbouring enemy', () => {
  const low = target(0, 200, 128, 10),
    high = target(1, 202, 128, 100),
    far = target(2, 260, 128, 10);
  const g = stationarySkill({ strike: 1 }, [low, high, far]);
  g.combat.fireSkill('strike');
  assert.ok(high.hp < 100);
  assert.ok(low.hp < 10, 'The splash reaches the neighbour');
  assert.equal(far.hp, 10);
  close(g.effects.find((f) => f.kind === 'strike')!.radius, g.forms.strike.splash);
});

test('strike finishes a wounded durable enemy before switching to a fresh one', () => {
  // Far enough apart that no splash lands on the others.
  const wounded = target(0, 200, 128, 100),
    fresh = target(1, 250, 128, 100),
    light = target(2, 225, 160, 80);
  wounded.hp = 15;
  const g = stationarySkill({ strike: 1 }, [wounded, fresh, light]);
  g.combat.fireSkill('strike');
  assert.equal(wounded.hp, 0);
  assert.equal(fresh.hp, 100);
  assert.equal(light.hp, 80);
  g.combat.fireSkill('strike');
  assert.ok(fresh.hp < 100);
  assert.equal(light.hp, 80);
});

test('strike retargets immediately when a wounded durable enemy leaves its range', () => {
  const far = target(0, 1000, 128, 100),
    near = target(1, 200, 128, 100);
  far.hp = 1;
  const g = stationarySkill({ strike: 1 }, [far, near]);
  g.combat.fireSkill('strike');
  assert.equal(far.hp, 1);
  assert.ok(near.hp < 100);
});

test('satellites grow one per rank, orbit the live electron, and carry attack modifiers', () => {
  const ts = Array.from({ length: 6 }, (_, i) => target(i, 205 + i * 8, 128, 1000));
  const g = stationarySkill({ satellite: 3, multi: 1, chain: 1, charge: 1 }, ts);
  assert.equal(g.combat.satellitePoints.length, 3);
  g.combat.fireSkill('satellite');
  assert.ok(g.combat.activations.chain !== undefined);
  assert.ok(g.combat.activations.multi !== undefined);
  assert.ok(g.combat.status('charge').progress > 0 || g.combat.activations.charge !== undefined);
  for (let rank = 1; rank <= 5; rank++) {
    g.ranks.satellite = rank;
    for (const rarity of rarityIds) {
      g.rarities.satellite = rarity;
      assert.equal(g.combat.satellitePoints.length, rank);
      for (const p of g.combat.satellitePoints)
        close(distance(p, g.position), rules.skills.satellite.orbitRadius);
    }
  }
  const before = g.combat.satellitePoints;
  g.angle += 0.5;
  g.advance(100);
  assert.notDeepEqual(g.combat.satellitePoints, before);
  for (const p of g.combat.satellitePoints)
    close(distance(p, g.position), rules.skills.satellite.orbitRadius);
  g.setManualPause(true);
  const paused = g.combat.satellitePoints;
  g.advance(1000);
  assert.deepEqual(g.combat.satellitePoints, paused);
});

test('satellite fire waits for nearby enemies and each body fires once per volley', () => {
  const g = stationarySkill({ satellite: 5 }, []);
  assert.equal(g.combat.fireSkill('satellite'), false);
  const p = target(0, g.position.x, g.position.y, 10000);
  g.targets = [p];
  assert.equal(g.combat.fireSkill('satellite'), true);
  close(10000 - p.hp, g.damage * g.forms.satellite.damage * 5);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 5);
});

test('passive recovery cannot hold an overloaded core open indefinitely', () => {
  const g = stationarySkill({ vent: 5 }, []);
  g.rarities.vent = 'legendary';
  g.mass = 1000;
  g.radius = 100;
  g.combat.learn('vent', 0);
  g.advance(120000);
  assert.equal(g.result?.outcome, 'collapse-failure');
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
  assert.ok(g.combat.status('charge').progress > 0 || g.combat.activations.charge !== undefined);
  const returned = g.effects.find((f) => f.kind === 'return')!;
  assert.ok(returned);
  assert.equal(returned.endAnchor, 'electron');
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
  assert.ok(g.effects.some((f) => f.kind === 'return' && f.endAnchor === 'electron'));
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
  assert.ok(visibleEffects(g.effects).some((f) => f.anchor === 'electron'));
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

test('ready timed skills wait for an eligible target and spend cooldown only on a cast', () => {
  for (const id of timedSkills) {
    const g = stationarySkill({}, []);
    choose(g, id);
    g.advance(10000);
    assert.deepEqual(
      g.combat.status(id),
      {
        mode: 'timed',
        progress: 1,
        active: false,
        fired: false,
      },
      id,
    );
    const p = target(0, 180, 128, 10000);
    if (id === 'chase') p.hp = 1000;
    g.targets.push(p);
    if (id === 'vent') g.mass = 2;
    g.advance(1000 / rules.tickRate);
    close(g.combat.status(id).progress, 0);
    assert.equal(g.combat.status(id).fired, true, id);
    assert.ok(g.combat.activations[id] !== undefined, id);
    g.targets = [];
    g.advance(rules.skills[id].periodSeconds * 1000 + 2000);
    assert.equal(g.combat.status(id).progress, 1, id);
  }
});

test('an overdue basic attack fires immediately in range without a catch-up burst', () => {
  const g = new Game(42, {
    rules: { ...rules, baseSpeed: 0, spawnSecondsByStage: Array(5).fill(10000) },
  });
  g.start();
  g.targets = [];
  g.advance(5000);
  const p = target(900, g.position.x, g.position.y, 10000);
  g.targets = [p];
  g.advance(1000 / rules.tickRate);
  assert.equal(p.hp, 10000 - g.damage);
  g.advance(100);
  assert.equal(p.hp, 10000 - g.damage);
});

test('regular basic attacks retain fractional cadence at every attack speed', () => {
  for (const rank of [0, 3, 7]) {
    const g = new Game(42, {
      rules: { ...rules, baseSpeed: 0, spawnSecondsByStage: Array(5).fill(10000) },
    });
    g.start();
    g.boosts.rate = rank;
    g.combat.rescaleCooldowns(1);
    g.targets = [target(900, g.position.x, g.position.y, 100000)];
    g.advance(60000);
    assert.equal(
      g.events.filter((e) => e.kind === 'hit').length,
      Math.floor(60 / g.attackInterval),
      'attack speed rank ' + rank,
    );
  }
});

test('linked cooldowns follow their own visible activation and preserve rate progress', () => {
  const p = target(0, 200, 128, 1000);
  const g = stationarySkill({ chain: 1, repeat: 1, return: 1 }, [p]);
  g.combat.fireBasic();
  assert.equal(g.combat.status('chain').progress, 1);
  assert.equal(g.combat.status('repeat').progress, 1);
  assert.equal(g.combat.status('return').progress, 1);
  g.advance(150);
  assert.ok(g.combat.status('repeat').progress < 1);
  assert.equal(g.combat.status('chain').progress, 1);
  g.advance(150);
  assert.ok(g.combat.status('return').progress < 1);
  const before = g.combat.status('repeat').progress;
  choose(g, 'rate');
  close(g.combat.status('repeat').progress, before);
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

test('beam damage follows primary, spread and delayed repeat hits rather than modifier level', () => {
  const g = stationarySkill({ multi: 2, repeat: 2 }, [
    target(1, 195, 128, 1000),
    target(2, 210, 128, 1000),
    target(3, 225, 128, 1000),
  ]);
  g.boosts.power = 1;
  g.combat.fireBasic();
  const primary = g.effects.filter((fx) => fx.kind === 'bolt');
  const hits = g.events
    .filter((e) => e.kind === 'hit')
    .map((e) => (e.data as { damage: number }).damage);
  assert.equal(primary.length, hits.length);
  primary.forEach((fx, i) => close(fx.damage, hits[i]));
  close(primary[0].damage, g.damage);
  close(primary[1].damage, g.damage * g.forms.multi.damage);
  g.advance(150);
  const echoes = g.effects.filter((fx) => fx.source === 'repeat');
  assert.ok(echoes.length > 0);
  echoes.forEach((fx) => {
    const main = primary.find((p) => p.targetId === fx.targetId)!;
    close(fx.damage, main.damage * g.forms.repeat.damage);
  });
});

test('chain falloff, pierced hits and returning paths publish their actual damage', () => {
  const g = stationarySkill({ chain: 3, pierce: 3, return: 3 }, [
    target(1, 195, 128, 1000),
    target(2, 210, 128, 1000),
    target(3, 225, 128, 1000),
  ]);
  g.boosts.power = 1;
  g.combat.fireBasic();
  const shaft = g.effects.find((fx) => fx.kind === 'pierce')!;
  close(shaft.damage, g.damage * rules.skills.pierce.damage);
  // Use a separate chain fixture so all next recipients remain available after the sweep.
  const chain = stationarySkill({ chain: 3 }, [
    target(1, 195, 128, 1000),
    target(2, 210, 128, 1000),
    target(3, 225, 128, 1000),
  ]);
  chain.boosts.power = 1;
  chain.combat.fireBasic();
  const arcs = chain.effects.filter((fx) => fx.source === 'chain');
  assert.equal(arcs.length, 2);
  arcs.forEach((fx, i) => close(fx.damage, chain.damage * rules.skills.chain.falloff ** (i + 1)));
  g.advance(300);
  const returned = g.effects.find((fx) => fx.kind === 'return')!;
  close(returned.damage, g.damage * g.forms.return.damage);
});
