import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { rules } from '../src/game/rules.ts';
import { bossPhase } from '../src/game/bosses.ts';
import { formationSlots, formationsAt } from '../src/game/formations.ts';
import { particleKind, particleMix } from '../src/game/particles.ts';
import type { BossKind } from '../src/game/bosses.ts';
import type { Target } from '../src/game/types.ts';
import { close, fixture, target } from './helpers.ts';

const behaviors = rules.boss.behaviors;

function boss(kind: BossKind, id = 50, x = 180, y = 120, hp = 1000): Target {
  return {
    ...target(id, x, y, hp),
    kind: 'boss',
    boss: kind,
    particle: 'neutron',
    size: rules.boss.size,
    xp: 0,
    mass: 10,
  };
}

test('each stage adds its own particle species at the designed stage', () => {
  const seen = rules.stageStarts.map((_, stage) => {
    const mix = particleMix(stage, rules.particles);
    const kinds = new Set<string>();
    for (let i = 0; i < 200; i++) {
      kinds.add(particleKind('small', i / 200, mix));
      kinds.add(particleKind('dense', i / 200, mix));
    }
    return [...kinds].sort();
  });
  assert.deepEqual(seen[0], ['proton', 'quark']);
  assert.deepEqual(seen[1], ['muon', 'proton', 'quark']);
  assert.deepEqual(seen[2], ['muon', 'neutron', 'proton', 'quark']);
  assert.deepEqual(seen[3], ['muon', 'neutrino', 'neutron', 'proton', 'quark']);
  assert.deepEqual(seen[4], ['meson', 'muon', 'neutrino', 'neutron', 'proton', 'quark']);
});

test('a neutrino first reveals itself, then takes damage', () => {
  const ghost = { ...target(1, 180, 150, 5), particle: 'neutrino' as const, veiled: true };
  const g = fixture({}, [ghost]);
  g.damageTarget(ghost, 3);
  assert.equal(ghost.hp, 5);
  assert.equal(ghost.veiled, false);
  assert.ok(g.events.some((e) => e.kind === 'reveal'));
  g.damageTarget(ghost, 3);
  assert.equal(ghost.hp, 2);
});

test('a meson splits into two quarks where it pops', () => {
  const meson = { ...target(1, 180, 150, 1), particle: 'meson' as const };
  const g = fixture({}, [meson]);
  g.damageTarget(meson, 5);
  const quarks = g.targets.filter((t) => t.particle === 'quark');
  assert.equal(quarks.length, rules.particles.split.quarks);
  for (const q of quarks) assert.ok(Math.hypot(q.x - 180, q.y - 150) < 6);
});

test('the gluon resists damage while its tethered quarks live', () => {
  const gluon = boss('gluon');
  const held = { ...target(2, 200, 120, 5), tether: gluon.id };
  const g = fixture({}, [gluon, held]);
  g.damageTarget(gluon, 100);
  close(gluon.hp, 1000 - 100 * behaviors.gluon.damageScale);
  g.damageTarget(held, 10);
  g.damageTarget(gluon, 100);
  close(gluon.hp, 1000 - 100 * behaviors.gluon.damageScale - 100);
});

test('the W boson turns nearby quarks into muons on its beat', () => {
  const w = boss('w');
  const near = target(2, 200, 120, 5),
    far = target(3, 180, 400, 5);
  const g = fixture({}, [w, near, far]);
  w.born = g.time;
  g.advance(behaviors.w.seconds * 1000);
  assert.equal(near.particle, 'muon');
  assert.equal(far.particle, 'quark');
  assert.ok(g.events.some((e) => e.kind === 'convert'));
});

test('the Z boson warns, then ignores damage while immune', () => {
  const { period, warnSeconds, immuneSeconds } = behaviors.z;
  assert.ok(bossPhase('z', period - immuneSeconds - warnSeconds / 2, behaviors).warning);
  assert.ok(bossPhase('z', period - immuneSeconds / 2, behaviors).immune);
  assert.ok(!bossPhase('z', 0.5, behaviors).immune);
  const z = boss('z');
  const g = fixture({}, [z]);
  z.born = g.time - (period - immuneSeconds / 2);
  g.damageTarget(z, 100);
  assert.equal(z.hp, 1000);
  z.born = g.time - 0.5;
  g.damageTarget(z, 100);
  assert.equal(z.hp, 900);
});

test('the tau pauses, charges and drops muons where each charge ends', () => {
  const { chargeSeconds, dashSeconds, dashSpeed, drops } = behaviors.tau;
  assert.equal(bossPhase('tau', chargeSeconds / 2, behaviors).speed, 0);
  assert.equal(bossPhase('tau', chargeSeconds + dashSeconds / 2, behaviors).speed, dashSpeed);
  const tau = { ...boss('tau'), speed: 1 };
  const g = fixture({}, [tau]);
  tau.born = g.time;
  g.advance((chargeSeconds + dashSeconds + 0.1) * 1000);
  assert.equal(g.targets.filter((t) => t.particle === 'muon').length, drops);
});

test('the top quark splits into mesons and the Higgs field weighs particles down', () => {
  const top = { ...boss('top'), summonCount: 6 };
  const g = fixture({}, [top]);
  g.damageTarget(top, 500);
  assert.equal(g.targets.filter((t) => t.particle === 'meson').length, 6);

  const higgs = { ...boss('higgs', 60), final: true, maxHp: 1000 };
  const inside = { ...target(2, 190, 125, 10), speed: 10 },
    outside = { ...target(3, 180, 400, 10), speed: 10 };
  const h = fixture({}, [higgs, inside, outside]);
  h.advance(1000 / 60);
  const field = rules.boss.final.field;
  assert.ok(inside.higgs && inside.speed === 10 * field.speed && inside.hp === 10 * field.hp);
  assert.equal(inside.mass, rules.targets.small.mass * field.mass);
  assert.ok(!outside.higgs);
  assert.equal(h.higgsField(higgs), field.radius);
  higgs.hp = 200;
  assert.equal(h.higgsField(higgs), field.wideRadius);
});

test('formations debut one at a time and keep their shape', () => {
  const cfg = rules.formations;
  assert.deepEqual(formationsAt(0, cfg), []);
  assert.deepEqual(formationsAt(cfg.debuts.line, cfg), ['line']);
  assert.deepEqual(formationsAt(cfg.debuts.arrow, cfg), ['line', 'clump', 'arrow']);
  assert.deepEqual(formationsAt(cfg.debuts.star, cfg), ['line', 'clump', 'arrow', 'star']);
  assert.deepEqual(formationsAt(cfg.debuts.pincer, cfg).length, 7);
  const line = formationSlots('line', 5, 1, 170, cfg);
  assert.ok(line.every((s) => s.theta === 1));
  const ring = formationSlots('ring', 8, 0, 170, cfg);
  close(ring[1].theta - ring[0].theta, Math.PI / 4);
  // Members of one formation share speed and turn, so moving keeps the shape.
  const g = new Game(7);
  g.start();
  // An idle run collapses before the first debut; an empty core keeps it running.
  for (let i = 0; i < 12000 && !g.pending.length; i++) {
    g.mass = 0;
    g.advance(1000 / 60);
  }
  assert.ok(g.pending.length, 'A formation is planned');
  const spawn = g.pending[0];
  assert.equal(new Set(spawn.members.map((m) => m.turn)).size, 1);
  const ids = g.targets.length;
  g.advance(rules.formations.previewSeconds * 1000 + 20);
  assert.ok(g.targets.length >= ids);
  assert.ok(!g.pending.includes(spawn));
});

test('the second giant particle down opens a fifth skill slot', () => {
  const g = fixture();
  assert.equal(g.skillSlots, rules.skillSlots);
  for (const id of [70, 71]) {
    const b = boss('gluon', id);
    g.targets = [b];
    g.damageTarget(b, 1e9);
  }
  assert.equal(g.skillSlots, rules.skillSlots + 1);
  assert.equal(g.banner?.kind, 'slot-open');
});
