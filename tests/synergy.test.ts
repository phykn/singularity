import test from 'node:test';
import assert from 'node:assert/strict';
import { distance } from '../src/game/geometry.ts';
import { rules } from '../src/game/rules.ts';
import { close, stationarySkill, target } from './helpers.ts';

test('gather branches share Multi damage scaling with their repeated hits', () => {
  const enemies = [target(0, 200, 128, 1000), target(1, 230, 128, 1000)];
  const g = stationarySkill({ gather: 1, multi: 1, repeat: 1 }, enemies);
  const damage = g.damage * g.forms.gather.damage;
  g.combat.fireSkill('gather');
  close(1000 - enemies[0].hp, damage);
  close(1000 - enemies[1].hp, damage * g.forms.multi.damage);
  g.advance(500);
  close(1000 - enemies[0].hp, damage * (1 + g.forms.repeat.damage));
  close(1000 - enemies[1].hp, damage * g.forms.multi.damage * (1 + g.forms.repeat.damage));
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

test('pursuit continues when a repeat finishes its wounded target, using the same jump budget', () => {
  const first = target(0, 190, 128, 100),
    second = target(1, 225, 128, 100);
  second.hp = 30;
  const g = stationarySkill({ chase: 1, repeat: 1 }, [first, second]);
  first.hp = g.damage * g.forms.chase.damage * (1 + g.forms.repeat.damage / 2);
  g.combat.fireSkill('chase');
  assert.ok(first.hp > 0);
  g.advance(150);
  assert.ok(first.hp <= 0);
  close(second.hp, 30);
  g.advance(110);
  assert.ok(second.hp < 30, 'The repeat kill must unlock the next pursuit');
  const jumps = g.events.filter(
    (e) => e.kind === 'skill-effect' && (e.data as { id: string }).id === 'chase',
  );
  assert.equal(jumps.length, 3, 'Initial delivery, cast activation and one follow-up');
});

test('pursuit repeats never retarget healthy enemies after a kill', () => {
  const g = stationarySkill({ chase: 5, repeat: 5 }, [
    target(0, 190, 128, 1),
    target(1, 205, 128, 1000),
  ]);
  // Mark the fragile target wounded without making the healthy neighbor eligible.
  g.targets[0].maxHp = 100;
  g.combat.fireSkill('chase');
  g.advance(1200);
  assert.equal(g.targets[0].hp, 1000);
});

test('gather and repel preserve safe radius while creating follow-up opportunities', () => {
  const enemies = [target(0, 190, 128, 1000), target(1, 230, 145, 1000), target(2, 245, 100, 1000)];
  const g = stationarySkill({ gather: 3, repel: 3, chain: 2, satellite: 3 }, enemies);
  const before = enemies.map((p) => p.radius);
  const spread = distance(enemies[0], enemies[1]);
  g.combat.fireSkill('gather');
  assert.ok(distance(enemies[0], enemies[1]) < spread);
  g.combat.fireSkill('repel');
  g.combat.fireSkill('satellite');
  enemies.forEach((p, i) => assert.ok(p.radius >= before[i]));
  assert.ok(g.combat.activations.chain !== undefined);
});

test('mass vent buys orbital room without multiplying healing through offensive modifiers', () => {
  const g = stationarySkill({ vent: 3, repeat: 5, multi: 5, charge: 5 }, [
    target(0, 200, 128, 1000),
  ]);
  g.mass = 80;
  g.radius = g.targetRadius;
  const before = g.radius;
  g.combat.fireSkill('vent');
  g.advance(1000);
  assert.equal(g.mass, 80 - rules.skills.vent.mass[3]);
  assert.ok(g.radius > before);
  assert.equal(g.targets[0].hp, 1000);
  assert.equal(g.combat.status('charge').progress, 0);
});
