import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { CENTER } from '../src/game/geometry.ts';
import { rules, skillIds } from '../src/game/rules.ts';
import type { SkillId } from '../src/game/rules.ts';
import type { TimedSkill } from '../src/game/skills.ts';
import type { Target } from '../src/game/types.ts';
import { fired, fixture, logged, strike, target, tickRate } from './helpers.ts';

// `hold` keeps the electron at the top of the orbit while time runs.
function hold(g: Game, seconds: number): void {
  for (let i = 0; i < seconds * tickRate; i++) {
    g.angle = -Math.PI / 2;
    g.run(1);
  }
}
// Rows of particles centred under the electron.
const grid = (hp: number, columns: number, rows: number, step = 15, first = 0, top = 145) =>
  Array.from({ length: columns * rows }, (_, i) =>
    target(
      first + i,
      180 + ((i % columns) - (columns - 1) / 2) * step,
      top + Math.floor(i / columns) * step,
      hp,
    ),
  );
const ring = (hp: number, count: number, radius: number, first = 0) =>
  Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    return target(first + i, CENTER.x + radius * Math.cos(a), CENTER.y + radius * Math.sin(a), hp);
  });
const basic = (g: Game) => g.combat.fireBasic();
const timed = (id: TimedSkill) => (g: Game) => g.combat.timed.fire(id);

test('every skill pops in its designed style', () => {
  assert.deepEqual(Object.fromEntries(skillIds.map((id) => [id, rules.skills[id].pop])), {
    repeat: 'tap',
    multi: 'burst',
    chain: 'tap',
    pierce: 'sweep',
    burst: 'domino',
    strike: 'burst',
    satellite: 'sweep',
    charge: 'release',
    surge: 'release',
    return: 'sweep',
    mark: 'tap',
    tempo: 'sweep',
    spark: 'tap',
    field: 'burst',
    fission: 'domino',
    overcharge: 'release',
  });
});

test('basic fire kills the nearest particle in range and grants its XP', () => {
  const g = fixture({}, [target(1, 190, 128), target(2, 240, 128)]);
  basic(g);
  assert.deepEqual(
    g.targets.map((t) => t.id),
    [2],
  );
  assert.equal(g.growth.xp, rules.particles.quark.xp);
  assert.equal(logged(g, 'kill')[0].data.id, 1);
});

test('each skill fires in combat', () => {
  const triggers: Partial<Record<SkillId, (g: Game) => unknown>> = {
    strike: timed('strike'),
    satellite: timed('satellite'),
    spark: timed('spark'),
    field: timed('field'),
    tempo: (g) => g.resonate(1),
    // Static Mark needs more different particles hit than one basic attack reaches.
    mark: (g) => [...g.targets].forEach((t) => strike(g, t)),
  };
  for (const id of skillIds) {
    // Skills fed by kills get weak particles in front of the tough ones.
    const hp = ['burst', 'fission', 'surge', 'overcharge'].includes(id) ? 1 : 1000,
      g = fixture({ [id]: 3 }, grid(hp, 3, id === 'mark' ? 3 : 2, 20, 0, 150));
    if (hp === 1) g.targets.push(...grid(1000, 3, 2, 20, 10, 190));
    for (let i = 0; i < 60 && !fired(g, id); i++) {
      g.angle = -Math.PI / 2;
      (triggers[id] ?? basic)(g);
      g.run(6);
      if (g.targets.filter((t) => t.maxHp === hp).length < 3)
        g.targets.push(...grid(hp, 3, 2, 20, 100 + i * 10, 150));
    }
    assert.ok(fired(g, id), `${id} never fired`);
  }
});

test('Thunderstrike picks the toughest particles in range and splashes around them', () => {
  const tough = target(1, 185, 170, 50),
    beside = target(2, 190, 172, 30),
    weak = target(3, 175, 150, 5),
    far = target(4, 180, 400, 999);
  const g = fixture({ strike: 1 }, [weak, tough, beside, far]);
  timed('strike')(g);
  assert.equal(g.effects.find((fx) => fx.kind === 'strike')!.targetId, tough.id);
  assert.ok(beside.hp < 30, 'splash missed the neighbour');
  assert.equal(weak.hp, 5);
  assert.equal(far.hp, 999);
  assert.equal(logged(g, 'thunder').length, 1);
});

test('Death Arc throws from the first kill; Pierce sweeps the line in order', () => {
  const arc = fixture({ burst: 1 }, [
    target(0, 180, 160, 1),
    target(1, 200, 160, 1),
    target(2, 160, 165, 1),
  ]);
  basic(arc);
  assert.equal(arc.targets.length, 0);
  const line = fixture({ pierce: 1 }, [
    target(0, 180, 150, 1),
    target(1, 180, 200, 1),
    target(2, 180, 230, 1),
  ]);
  basic(line);
  const delays = logged(line, 'kill').map((e) => e.data.delay);
  assert.equal(delays.length, 3);
  assert.ok(delays[1] < delays[2], `${delays}`);
});

test('Repeat and Chain ride Thunderstrike; Charged Bolt takes neither', () => {
  const wait = Math.ceil(rules.skills.repeat.delaySeconds * tickRate) + 1,
    thunder = fixture({ strike: 1, repeat: 2, chain: 2 }, grid(1000, 3, 2, 20));
  timed('strike')(thunder);
  thunder.run(wait);
  assert.ok(fired(thunder, 'repeat') && fired(thunder, 'chain'));
  const spark = fixture({ spark: 1, repeat: 2, chain: 2 }, grid(1000, 3, 2, 20));
  timed('spark')(spark);
  spark.run(30);
  assert.ok(fired(spark, 'spark'));
  assert.ok(!fired(spark, 'repeat') && !fired(spark, 'chain'));
});

test('the kill that starts a surge does not extend it', () => {
  // Far below the electron, out of the surge's reach: only these kills count.
  const g = fixture({ surge: 1 }, grid(1, 4, 3, 15, 0, 400)),
    surge = g.growth.values.surge;
  g.growth.evolved.surge = true;
  for (let i = 0; i < surge.kills; i++) strike(g, g.targets[0]);
  assert.equal(g.combat.status('surge').active, true);
  const until = g.time + surge.duration;
  strike(g, g.targets[0]);
  g.run(Math.round((until - g.time) * tickRate) + 1);
  assert.equal(g.combat.charges.surging, true, 'a kill while surging extends it');
  g.run(Math.ceil(rules.skills.surge.evolution.extendSeconds * tickRate) + 1);
  assert.equal(g.combat.charges.surging, false, 'the starting kill added no extension');
});

const hits = (g: Game) => logged(g, 'hit').length;
// Each scenario runs on the same fixture with and without the evolution; `measure` reads the
// difference (hits by default).
const evolutions: Record<
  SkillId,
  { targets: () => Target[]; run: (g: Game) => void; measure?: (g: Game) => number }
> = {
  // Kills add Repeat hits.
  repeat: { targets: () => grid(1, 5, 4), run: (g) => (basic(g), hold(g, 2)) },
  // Fork links its primaries.
  multi: { targets: () => grid(1000, 3, 2), run: basic },
  // The chain turns back.
  chain: { targets: () => grid(1000, 3, 2, 30), run: basic },
  // Pierce leaves a trail that keeps hitting.
  pierce: {
    targets: () => [target(0, 180, 150, 1000), target(1, 180, 200, 1000)],
    run: (g) => (basic(g), hold(g, 1.5)),
  },
  // Particles popped by a discharge discharge again.
  burst: { targets: () => grid(1, 7, 5, 14), run: basic },
  // Bolts keep falling between strikes.
  strike: { targets: () => grid(1000, 3, 2), run: (g) => (timed('strike')(g), hold(g, 1.2)) },
  // The satellites are joined into a ring.
  satellite: { targets: () => grid(1000, 5, 5, 10, 0, 108), run: timed('satellite') },
  // A discharge spreads as a ring around the electron.
  charge: {
    targets: () => grid(1000, 3, 2),
    run: (g) => {
      for (let i = 0; i < 3; i++) (basic(g), hold(g, 0.1));
    },
  },
  // Kills while surging extend it; measured in ticks surging.
  surge: {
    targets: () => grid(1, 4, 3, 15, 0, 400),
    run: (g) => {
      for (let i = 0; i < g.growth.values.surge.kills + 1; i++) strike(g, g.targets[0]);
    },
    measure: (g) => {
      let ticks = 0;
      for (; g.combat.charges.surging && ticks < 600; ticks++) g.run(1);
      return ticks;
    },
  },
  // The returning bolt bounces back out once more.
  return: { targets: () => [target(0, 180, 170, 1000)], run: (g) => (basic(g), hold(g, 1)) },
  // A detonation passes fresh marks to neighbours; measured in marked particles.
  mark: {
    targets: () => grid(1000, 5, 4),
    run: (g) => g.targets.slice(0, g.growth.values.mark.threshold).forEach((t) => strike(g, t)),
    measure: (g) => g.targets.filter((t) => t.marked).length,
  },
  // The third beat sweeps the whole lap.
  tempo: { targets: () => ring(1e6, 30, 100), run: (g) => (g.resonate(3), g.run(60)) },
  // Each spark bounces once.
  spark: { targets: () => grid(1000, 4, 3, 20), run: (g) => (timed('spark')(g), hold(g, 1)) },
  // Kills leave a remnant field that hits what stayed.
  field: {
    targets: () => grid(1, 3, 2, 30).concat(grid(1000, 3, 2, 30, 10, 155)),
    run: (g) => (timed('field')(g), g.run(60)),
  },
  // Each later split reaches further: B to C is beyond the base radius.
  fission: {
    targets: () => [target(0, 180, 160, 1), target(1, 230, 160, 1), target(2, 302, 160, 1)],
    run: (g) => (basic(g), g.run(60)),
  },
  // The discharge echoes once.
  overcharge: {
    targets: () => ring(1, 16, 60).concat(ring(1000, 8, 132, 20)),
    run: (g) => {
      g.targets.slice(0, g.growth.values.overcharge.kills).forEach((t) => strike(g, t));
      g.run(60);
    },
  },
};

test('each of the sixteen evolutions changes what its skill does', () => {
  for (const id of skillIds) {
    const { targets, run, measure = hits } = evolutions[id];
    const play = (evolved: boolean) => {
      const g = fixture({ [id]: rules.growth.maxRank }, targets());
      if (evolved) g.growth.evolved[id] = true;
      run(g);
      return measure(g);
    };
    const plain = play(false),
      evolved = play(true);
    assert.ok(evolved > plain, `${id}: evolved ${evolved}, plain ${plain}`);
  }
});
