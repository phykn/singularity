import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { rules, skillIds } from '../src/game/rules.ts';
import type { SkillId } from '../src/game/rules.ts';
import { fixture, target } from './helpers.ts';

// The pop style of each skill as the design defines it (archive SPEC §4.1).
const pops: Record<SkillId, string> = {
  chain: 'tap',
  repeat: 'tap',
  mark: 'tap',
  spark: 'tap',
  multi: 'burst',
  strike: 'burst',
  field: 'burst',
  burst: 'domino',
  fission: 'domino',
  charge: 'release',
  surge: 'release',
  overcharge: 'release',
  pierce: 'sweep',
  return: 'sweep',
  satellite: 'sweep',
  tempo: 'sweep',
};

test('every skill pops in its designed style', () => {
  assert.deepEqual(Object.fromEntries(skillIds.map((id) => [id, rules.skills[id].pop])), pops);
});

test('all sixteen skills rise to rank 5 and no further', () => {
  for (const id of skillIds) {
    const g = new Game(1);
    g.start();
    for (let number = 1; number <= 6; number++) {
      g.choice = { number, cards: [{ id, rarity: 'common' }] };
      assert.equal(g.choose(id, number), number <= rules.growth.maxRank, `${id} pick ${number}`);
    }
    assert.equal(g.ranks[id], rules.growth.maxRank, id);
  }
});

// Electron at the top of the orbit (180, 128); a crowd of three columns just below it.
const crowd = (hp = 1000, count = 6, first = 0, top = 150) =>
  Array.from({ length: count }, (_, i) =>
    target(first + i, 160 + (i % 3) * 20, top + Math.floor(i / 3) * 20, hp),
  );
const fired = (g: Game, id: SkillId) =>
  g.events.some((e) => e.kind === 'skill-effect' && e.data.id === id);

test('each skill fires in combat', () => {
  const triggers: Partial<Record<SkillId, (g: Game) => void>> = {
    strike: (g) => g.combat.fireSkill('strike'),
    satellite: (g) => g.combat.fireSkill('satellite'),
    spark: (g) => g.combat.fireSkill('spark'),
    field: (g) => g.combat.fireSkill('field'),
    // Static Mark needs many different particles hit, more than one basic attack reaches.
    mark: (g) => {
      for (const t of [...g.targets])
        g.combat.deal(
          { power: 10, damage: 1, range: 99, depth: 0, budget: { burst: false } },
          t,
          1,
        );
    },
  };
  for (const id of skillIds) {
    if (id === 'tempo') continue; // Beats arrive with the rhythm (T8).
    const killing = ['burst', 'fission', 'surge', 'overcharge'].includes(id),
      g = fixture({ [id]: 3 }, crowd(killing ? 1 : 1000, id === 'mark' ? 9 : 6));
    if (killing) g.targets.push(...crowd(1000, 6, 10, 190));
    for (let i = 0; i < 60 && !fired(g, id); i++) {
      g.angle = -Math.PI / 2;
      (triggers[id] ?? ((game: Game) => game.combat.fireBasic()))(g);
      g.run(6);
      // Killing skills get fresh weak particles in front of the tough ones.
      const hp = killing ? 1 : 1000;
      if (g.targets.filter((t) => t.maxHp === hp).length < 3)
        g.targets.push(...crowd(hp, 6, 100 + i * 10));
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
  g.combat.fireSkill('strike');
  const strike = g.effects.find((fx) => fx.kind === 'strike')!;
  assert.equal(strike.targetId, tough.id);
  assert.ok(beside.hp < 30, 'splash missed the neighbour');
  assert.equal(weak.hp, 5);
  assert.equal(far.hp, 999);
  assert.ok(g.events.some((e) => e.kind === 'thunder'));
});

test('the kill that starts a surge does not extend it (89565dc)', () => {
  // Far below the electron, out of the surge's reach: only these kills count.
  const g = fixture({ surge: 1 }, crowd(1, 12, 0, 400));
  g.evolved.surge = true;
  const kills = g.forms.surge.kills;
  for (let i = 0; i < kills; i++)
    g.combat.deal(
      { power: 10, damage: 10, range: 99, depth: 0, budget: { burst: false } },
      g.targets[0],
      10,
    );
  const status = g.combat.status('surge');
  assert.equal(status.active, true);
  const until = g.time + g.forms.surge.duration;
  // One more kill while surging extends it by `extendSeconds`.
  g.combat.deal(
    { power: 10, damage: 10, range: 99, depth: 0, budget: { burst: false } },
    g.targets[0],
    10,
  );
  g.run(Math.round((until - g.time) * rules.time.tickRate) + 1);
  assert.equal(g.combat.surging, true, 'the second kill extends the surge');
  g.run(Math.ceil(rules.skills.surge.evolution.extendSeconds * rules.time.tickRate) + 1);
  assert.equal(g.combat.surging, false, 'only one extension: the starting kill added none');
});

test('Repeat and Chain ride Thunderstrike; Charged Bolt takes neither', () => {
  const strike = fixture({ strike: 1, repeat: 2, chain: 2 }, crowd());
  strike.combat.fireSkill('strike');
  strike.run(Math.ceil(rules.skills.repeat.delaySeconds * rules.time.tickRate) + 1);
  assert.ok(fired(strike, 'repeat') && fired(strike, 'chain'));
  const spark = fixture({ spark: 1, repeat: 2, chain: 2 }, crowd());
  spark.combat.fireSkill('spark');
  spark.run(30);
  assert.ok(fired(spark, 'spark'));
  assert.ok(!fired(spark, 'repeat') && !fired(spark, 'chain'));
});
