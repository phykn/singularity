import test from 'node:test';
import assert from 'node:assert/strict';
import { distance } from '../src/game/geometry.ts';
import { rules } from '../src/game/rules.ts';
import { close, stationarySkill, target } from './helpers.ts';

test('strike branches share Multi damage scaling with their repeated hits', () => {
  const enemies = [target(0, 200, 128, 1000), target(1, 230, 128, 900)];
  const g = stationarySkill({ strike: 1, multi: 1, repeat: 1 }, enemies);
  g.combat.fireSkill('strike');
  g.advance(60);
  const first = 1000 - enemies[0].hp,
    second = 900 - enemies[1].hp;
  assert.ok(first > 0 && second > 0, 'Fork adds a second strike target');
  g.advance(500);
  assert.ok(1000 - enemies[0].hp > first, 'Repeat follows the strike');
  assert.ok(900 - enemies[1].hp > second, 'Repeat follows the forked strike');
});

test('satellites distribute fire before sharing a target and repeats follow their live emitter', () => {
  const enemies = [target(0, 181, 128, 1000), target(1, 185, 130, 1000), target(2, 185, 126, 1000)];
  const g = stationarySkill({ satellite: 3, repeat: 1 }, enemies);
  g.combat.fireSkill('satellite');
  enemies.forEach((p) => close(1000 - p.hp, g.damage * g.forms.satellite.damage));
  g.angle += 0.4;
  g.advance(150);
  const echoes = g.effects.filter((fx) => fx.source === 'repeat');
  assert.equal(echoes.length, 3);
  for (const fx of echoes) {
    assert.equal(typeof fx.anchor, 'number');
    const angle =
      fx.born * rules.skills.satellite.angularSpeed + (Number(fx.anchor) * Math.PI * 2) / 3;
    close(fx.from.x, g.position.x + Math.cos(angle) * rules.skills.satellite.orbitRadius);
    close(fx.from.y, g.position.y + Math.sin(angle) * rules.skills.satellite.orbitRadius);
  }
});

test('satellite return currents close on their own moving satellite, not the central electron', () => {
  const g = stationarySkill({ satellite: 2, return: 1 }, [target(0, 185, 128, 10000)]);
  g.combat.fireSkill('satellite');
  g.angle += 0.5;
  g.advance(300);
  const returning = g.effects.filter((fx) => fx.kind === 'return');
  assert.equal(returning.length, 2);
  for (const fx of returning) {
    assert.equal(typeof fx.endAnchor, 'number');
    assert.ok(distance(fx.to, g.combat.satellitePoints[fx.endAnchor as number]) < 2);
    assert.ok(distance(fx.to, g.position) > 20);
  }
});

test('satellite fork, chain and pierce deliver real additional hits beyond the primary', () => {
  for (const modifier of ['multi', 'chain', 'pierce'] as const) {
    const enemies = [
      target(0, 218, 128, 1000),
      target(1, 230, 128, 1000),
      target(2, 260, 128, 1000),
    ];
    const g = stationarySkill({ satellite: 1, [modifier]: 2 }, enemies);
    g.combat.fireSkill('satellite');
    assert.ok(enemies[0].hp < 1000);
    assert.ok(enemies[1].hp < 1000, modifier);
    assert.ok(g.combat.activations[modifier] !== undefined);
  }
});

test('satellite hits feed Charge and Surge; satellite kills can release Burst', () => {
  const g = stationarySkill({ satellite: 1, charge: 1, surge: 1 }, [target(0, 185, 128, 10000)]);
  for (let i = 0; i < 12; i++) {
    g.combat.fireSkill('satellite');
    g.advance(200);
  }
  assert.ok(g.combat.activations.charge !== undefined);
  assert.ok(g.combat.status('surge').progress > 0);
  const h = stationarySkill({ satellite: 1, burst: 1 }, [
    target(0, 218, 128, 1),
    target(1, 235, 128, 1000),
  ]);
  h.combat.fireSkill('satellite');
  assert.ok(h.combat.activations.burst !== undefined);
  assert.ok(h.targets[0].hp < 1000);
});
