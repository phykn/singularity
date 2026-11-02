import test from 'node:test';
import assert from 'node:assert/strict';
import { orbit } from '../src/game/geometry.ts';
import { rarityIds, rules } from '../src/game/rules.ts';
import type { Ranks } from '../src/game/rules.ts';
import { visibleEffects } from '../src/render/effects.ts';
import { close, stationarySkill, target } from './helpers.ts';

function setup(ranks: Partial<Ranks> = {}, angle = -Math.PI / 2) {
  const p = orbit(angle + 0.2, rules.orbitRadius);
  const enemy = target(0, p.x, p.y, 10000);
  const g = stationarySkill({ bridge: 5, ...ranks }, [enemy]);
  g.angle = angle;
  return { g, enemy };
}

test('orbit barrier grows only along traveled orbit, stops at its cap and expires', () => {
  const { g, enemy } = setup({ bridge: 1 });
  g.combat.fireSkill('bridge');
  g.advance(100);
  assert.equal(g.effects.filter((f) => f.kind === 'bridge').length, 0);
  assert.equal(enemy.hp, 10000);
  g.angle += 0.1;
  g.advance(120);
  close(g.effects.find((f) => f.arc)!.arc!.sweep, 0.1);
  assert.equal(enemy.hp, 10000, 'The untraveled part must not block enemies');
  g.angle += 2;
  g.advance(120);
  close(g.effects.findLast((f) => f.arc)!.arc!.sweep, (g.forms.bridge.angle * Math.PI) / 180);
  assert.ok(enemy.hp < 10000);
  assert.equal(enemy.controlCount, undefined, 'The net holds particles instead of pushing them');
  assert.equal(g.combat.movementScale(enemy), rules.skills.bridge.movementScale);
  g.advance(2000 + rules.skills.bridge.slowSeconds * 1000);
  assert.equal(g.combat.status('bridge').active, false);
  assert.equal(g.combat.movementScale(enemy), 1);
  assert.ok(!g.effects.some((f) => f.kind === 'bridge'));
});

test('arc contact wraps angles but leaves radial and angular gaps open', () => {
  const { g, enemy } = setup({}, Math.PI - 0.1);
  const others = [
    [g.angle + 0.2, g.radius - 30],
    [g.angle + 0.2, g.radius + 30],
    [g.angle - 0.2, g.radius],
    [g.angle + 2, g.radius],
  ].map(([angle, radius], i) => {
    const p = orbit(angle, radius);
    return target(i + 1, p.x, p.y, 10000);
  });
  g.targets.push(...others);
  g.combat.fireSkill('bridge');
  g.angle += 1;
  g.advance(20);
  assert.ok(enemy.hp < 10000);
  assert.ok(others.every((p) => p.hp === 10000));
});

test('fast radial crossings cannot tunnel through an existing barrier', () => {
  const { g, enemy } = setup();
  enemy.radius = g.radius + 25;
  Object.assign(enemy, orbit(enemy.angle, enemy.radius));
  g.combat.fireSkill('bridge');
  g.angle += 0.4;
  g.advance(20);
  assert.equal(enemy.hp, 10000);
  enemy.speed = 3000;
  g.advance(1000 / rules.tickRate);
  assert.ok(enemy.hp < 10000);
  assert.equal(enemy.controlCount, undefined);
});

test('a particle held in the net is zapped again every zap interval', () => {
  const { g, enemy } = setup({ bridge: 1 });
  g.combat.fireSkill('bridge');
  g.angle += 0.5;
  g.advance(1000);
  const zaps = g.events.filter(
    (e) => e.kind === 'hit' && (e.data as { id: number }).id === enemy.id,
  ).length;
  assert.equal(zaps, Math.ceil(1 / rules.skills.bridge.zapSeconds));
  close(10000 - enemy.hp, zaps * g.damage * g.forms.bridge.damage);
});

test('overlapping arcs share one zap cadence and never push', () => {
  const { g, enemy } = setup({ repeat: 5 });
  assert.equal(g.combat.fireSkill('bridge'), true);
  assert.equal(g.combat.fireSkill('bridge'), true);
  assert.equal(g.combat.fireSkill('bridge'), false);
  g.angle += 0.5;
  g.advance(20);
  close(10000 - enemy.hp, g.damage * g.forms.bridge.damage);
  const radius = enemy.radius;
  g.advance(500);
  assert.ok(10000 - enemy.hp > g.damage * g.forms.bridge.damage);
  close(enemy.radius, radius);
  assert.equal(enemy.controlCount, undefined);
  g.advance((g.forms.bridge.duration + rules.skills.bridge.slowSeconds) * 1000);
  assert.equal(g.combat.movementScale(enemy), 1, 'Slow ends once the net is gone');
  g.combat.clear();
  assert.equal(g.combat.status('bridge').active, false);
  assert.equal(enemy.bridgeReady, 0);
});

test('barrier contact chains and stores weighted charge without recursive barriers', () => {
  const { g, enemy } = setup({ repeat: 2, chain: 1, charge: 1 });
  const p = orbit(enemy.angle, g.radius + 25);
  const neighbor = target(1, p.x, p.y, 10000);
  g.targets.push(neighbor);
  g.combat.fireSkill('bridge');
  g.angle += 0.5;
  // Stop before the next zap so the stored charge has not discharged yet.
  g.advance(180);
  assert.ok(neighbor.hp < 10000, 'Chain must reach beyond the contact band');
  assert.ok(g.combat.activations.chain !== undefined);
  assert.ok(g.combat.activations.repeat !== undefined);
  const stored = g.combat.status('charge').progress * g.forms.charge.threshold;
  const weighted = g.events
    .filter((e) => e.kind === 'hit')
    .reduce((sum, e) => sum + Math.min(1, (e.data as { damage: number }).damage / g.damage), 0);
  close(stored, weighted);
  assert.ok(stored > g.forms.bridge.damage && stored < g.forms.charge.threshold);
  assert.equal(visibleEffects(g.effects).filter((f) => f.kind === 'bridge').length, 1);
});

test('the net zaps without pushing, leaving pushes to Repel', () => {
  const { g, enemy } = setup({ repel: 1 });
  g.combat.fireSkill('bridge');
  enemy.radius = g.radius;
  Object.assign(enemy, orbit(enemy.angle, enemy.radius));
  g.angle += 0.5;
  g.advance(20);
  assert.ok(enemy.hp < 10000);
  assert.equal(enemy.controlCount, undefined);
  close(enemy.radius, g.radius);
  g.combat.fireSkill('repel', enemy);
  assert.equal(enemy.controlCount, 1);
  close(enemy.radius - g.radius, g.forms.repel.push);
});

test('Fork broadens defense while rank, rarity and range can never close the orbit', () => {
  const { g } = setup({ bridge: 1 });
  const first = g.forms.bridge;
  g.ranks.multi = 5;
  assert.ok(g.forms.bridge.angle > first.angle);
  g.ranks.bridge = 5;
  assert.ok(g.forms.bridge.duration > first.duration);
  for (const rarity of rarityIds) {
    g.rarities.bridge = rarity;
    g.rarities.multi = rarity;
    const before = g.forms.bridge.angle;
    g.boosts.range = 99;
    close(g.forms.bridge.angle, before);
    assert.ok(g.forms.bridge.angle * rules.skills.bridge.maxArcs < 180);
  }
});

test('high fire rate keeps at most two arcs and waits ready until a slot expires', () => {
  const { g } = setup();
  g.boosts.rate = 99;
  g.combat.learn('bridge', 0);
  let max = 0;
  for (let tick = 0; tick < 210; tick++) {
    g.angle += 0.02;
    g.advance(1000 / rules.tickRate);
    const arcs = visibleEffects(g.effects).filter((f) => f.kind === 'bridge');
    max = Math.max(max, arcs.length);
    assert.ok(arcs.length <= 2);
    if (g.time > 1 && g.time < 2) close(g.combat.status('bridge').progress, 1);
  }
  assert.equal(max, 2);
  assert.ok(
    g.events.filter((e) => e.kind === 'skill-effect' && (e.data as { id: string }).id === 'bridge')
      .length > 2,
    'An expired slot must allow a new cast',
  );
});
