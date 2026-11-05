import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game/Game.ts';
import { createCheckpoint, restoreCheckpoint } from '../src/game/checkpoint.ts';
import {
  evolutionChance,
  isPact,
  pactIds,
  rules,
  skillIds,
  xpForLevel,
} from '../src/game/rules.ts';
import type { PactId, Ranks } from '../src/game/rules.ts';
import { pactText } from '../src/ui/skillText.ts';
import { copy, languages } from '../src/ui/i18n.ts';
import { choose, close, fixture, stationarySkill, target } from './helpers.ts';
import { playRhythm } from '../scripts/rhythm-bot.ts';

const tick = (g: Game) => g.advance(1000 / rules.tickRate);
// Moves the clock so the next tick lands exactly on `seconds`.
const before = (g: Game, seconds: number) => {
  g.tick = Math.round(seconds * rules.tickRate) - 1;
};
// Plays the tick on which `seconds` arrives.
const reach = (g: Game, seconds: number) => {
  before(g, seconds);
  g.choice = null;
  tick(g);
};
const bossesSeen = (g: Game) => g.events.filter((event) => event.kind === 'boss');
const spawned = () => {
  const g = new Game(5);
  g.start();
  return g;
};

test('critical breach starts once at its time, tightens the orbit and strengthens spawns', () => {
  const g = fixture();
  const relaxed = g.targetRadius;
  g.debugSetXp(xpForLevel(200));
  g.choice = null;
  before(g, rules.critical.time);
  assert.equal(g.critical, false);
  g.tick++;
  assert.equal(g.critical, true);
  assert.equal(g.targetRadius, relaxed - rules.critical.pull);
  assert.equal(g.enemyStrength.hp, rules.critical.hpScale);
  g.selections.length = 100;
  tick(g);
  tick(g);
  assert.equal(g.events.filter((event) => event.kind === 'critical').length, 1);
  assert.equal(g.banner?.kind, 'critical');
});

test('critical breach slows XP without losing fractions', () => {
  const g = fixture();
  g.tick = rules.critical.time * rules.tickRate;
  g.selections.length = 100;
  const start = g.xp;
  for (let i = 0; i < 5; i++) {
    g.targets = [target(i, 180, 128, 1)];
    g.combat.fireBasic(g.targets[0]);
  }
  assert.equal(g.xp, start + Math.floor(5 * rules.critical.xpScale));
});

const firstStage = rules.boss.stages[0];

test('each giant particle arrives on the tick its time comes, whatever the XP', () => {
  for (const xp of [0, xpForLevel(200)]) {
    const g = spawned();
    g.selections.length = 100;
    g.xp = xp;
    rules.boss.stages.forEach((stage, i) => {
      before(g, stage.time - 1 / rules.tickRate);
      g.choice = null;
      tick(g);
      assert.equal(bossesSeen(g).length, i, `${stage.kind} waits for ${stage.time}s`);
      tick(g);
      assert.equal(g.time, stage.time);
      assert.equal(bossesSeen(g).length, i + 1);
      assert.equal((bossesSeen(g).at(-1)!.data as { boss: string }).boss, stage.kind);
    });
  }
});

test('the next giant particle keeps its time while an earlier one still lives', () => {
  const g = spawned();
  g.selections.length = 100;
  reach(g, rules.boss.stages[0].time);
  const first = g.boss!;
  reach(g, rules.boss.stages[1].time);
  const live = g.targets.filter((t) => t.kind === 'boss');
  assert.ok(live.includes(first));
  assert.deepEqual(
    live.map((t) => t.boss),
    [rules.boss.stages[0].kind, rules.boss.stages[1].kind],
  );
});

test('the critical breach and the Higgs arrive at their times with their banner and cue', () => {
  const g = spawned();
  g.selections.length = 100;
  for (const stage of rules.boss.stages) reach(g, stage.time);
  before(g, rules.critical.time);
  g.choice = null;
  assert.equal(g.events.filter((event) => event.kind === 'critical').length, 0);
  tick(g);
  assert.equal(g.events.filter((event) => event.kind === 'critical').length, 1);
  assert.equal(g.banner?.kind, 'critical');
  before(g, rules.boss.final.time);
  g.choice = null;
  assert.equal(g.events.filter((event) => event.kind === 'charged').length, 0);
  tick(g);
  assert.equal(g.events.filter((event) => event.kind === 'final-boss').length, 1);
  assert.equal(g.events.filter((event) => event.kind === 'charged').length, 1);
  assert.equal(g.boss?.final, true);
});

test('the boss arrives once at its time with a warning and reports its fate', () => {
  const g = spawned();
  g.selections.length = 100;
  reach(g, firstStage.time);
  const boss = g.boss!;
  assert.equal(boss.kind, 'boss');
  assert.equal(g.banner?.kind, 'boss');
  assert.equal(g.events.filter((event) => event.kind === 'boss').length, 1);
  g.targets = g.targets.filter((t) => t === boss);
  tick(g);
  assert.equal(g.events.filter((event) => event.kind === 'boss').length, 1);
  boss.radius = g.core;
  const mass = g.mass;
  g.absorbTargets();
  assert.equal(g.mass, mass + firstStage.mass);
  assert.equal(g.events.filter((event) => event.kind === 'boss-absorbed').length, 1);
  assert.equal(g.boss, undefined);
});

test('the core grows while the boss lives and stops once it is gone', () => {
  const g = fixture();
  g.selections.length = 100;
  const boss = target(1, 180, 60, 1e6);
  boss.kind = 'boss';
  g.targets = [boss];
  const seconds = 5;
  for (let i = 0; i < seconds * rules.tickRate; i++) tick(g);
  assert.equal(g.mass, Math.floor(seconds / rules.boss.feedSeconds));
  g.targets = [];
  const mass = g.mass;
  for (let i = 0; i < seconds * rules.tickRate; i++) tick(g);
  assert.equal(g.mass, mass);
});

test('damaging the boss summons each escort group once and a kill pays its reward', () => {
  const g = spawned();
  g.selections.length = 100;
  reach(g, firstStage.time);
  const boss = g.boss!;
  g.targets = [boss];
  g.damageTarget(boss, boss.maxHp * 0.4);
  assert.equal(g.targets.length, 1 + firstStage.summonCount);
  g.damageTarget(boss, 1);
  assert.equal(g.targets.length, 1 + firstStage.summonCount);
  g.damageTarget(boss, boss.maxHp * 0.4);
  assert.equal(g.targets.length, 1 + 2 * firstStage.summonCount);
  const xp = g.xp;
  g.damageTarget(boss, boss.maxHp);
  assert.equal(g.xp, xp + firstStage.xp);
  assert.equal(g.banner?.kind, 'boss-down');
  assert.equal(g.events.filter((event) => event.kind === 'boss-down').length, 1);
});

const bossesAtGoal = () => {
  const g = spawned();
  g.selections.length = 100;
  before(g, rules.boss.final.time);
  for (let i = 0; i <= rules.boss.stages.length; i++) {
    g.choice = null;
    tick(g);
  }
  return g;
};

test('every middle boss arrives in order before the final boss, numbered and independent', () => {
  const g = bossesAtGoal();
  const seen = g.targets.filter((t) => t.kind === 'boss');
  assert.equal(g.bossCount, rules.boss.stages.length);
  assert.equal(seen.length, rules.boss.stages.length + 1);
  assert.deepEqual(
    seen.slice(0, -1).map((t) => t.xp),
    rules.boss.stages.map((stage) => stage.xp),
  );
  assert.equal(g.events.filter((event) => event.kind === 'final-boss').length, 1);
  assert.equal(g.boss, seen.at(-1), 'The final boss takes priority once it is present');
  const [first, second] = seen;
  g.targets = [first, second];
  g.damageTarget(first, first.maxHp * 0.4);
  g.damageTarget(second, second.maxHp * 0.4);
  assert.equal(g.targets.length, 2 + first.summonCount! + second.summonCount!);
});

test('the Higgs time alone never ends the run and choices keep coming during the final fight', () => {
  const g = fixture();
  g.xp = xpForLevel(200);
  g.selections.length = 100;
  before(g, rules.boss.final.time);
  for (let i = 0; i < 300; i++) {
    g.choice = null;
    tick(g);
  }
  assert.equal(g.phase, 'running');
  assert.equal(g.finalProgress, 1);
  const level = g.level;
  g.selections.length = 0;
  (g as unknown as { openChoice(): void }).openChoice();
  assert.ok(g.choice, `Level ${level} still opens a choice`);
});

test('destroying the final boss is the only clear and is reported once', () => {
  const g = bossesAtGoal();
  const final = g.boss!;
  assert.equal(final.final, true);
  g.targets = [final];
  g.damageTarget(final, final.maxHp);
  g.choice = null;
  tick(g);
  assert.equal(g.phase, 'collapse');
  assert.equal(g.successfulEnding, true);
  assert.equal(g.events.filter((event) => event.kind === 'final-boss-down').length, 1);
  g.advance((rules.collisionSeconds + rules.successEndingSeconds) * 1000 + 100);
  assert.equal(g.result?.outcome, 'success');
  assert.equal(g.result?.trigger, 'boss');
});

test('the final boss reaching the core fails the run even with full energy', () => {
  const g = bossesAtGoal();
  const final = g.boss!;
  g.targets = [final];
  final.radius = g.core;
  g.choice = null;
  tick(g);
  assert.equal(g.phase, 'collapse');
  assert.equal(g.successfulEnding, false);
  g.advance((rules.collisionSeconds + rules.failureEndingSeconds) * 1000 + 100);
  assert.equal(g.result?.outcome, 'collapse-failure');
  assert.equal(g.result?.trigger, 'gravity');
});

test('the boss and critical breach stay out of endless play', () => {
  const g = new Game(1500003);
  g.start();
  g.debugClear();
  g.advance((rules.collisionSeconds + rules.successEndingSeconds) * 1000 + 100);
  assert.equal(g.result?.outcome, 'success');
  assert.ok(g.continueBeyond());
  assert.equal(g.critical, false);
  while (g.phase === 'crossing') tick(g);
  const seen = g.events.filter((event) => event.kind === 'boss').length;
  for (let i = 0; i < 600 && g.phase === 'running'; i++) {
    g.choice = null;
    tick(g);
  }
  assert.equal(g.events.filter((event) => event.kind === 'boss').length, seen);
});

// Pins every card draw to one value, so a test decides the evolution roll.
const evolutionFixture = () => {
  const g = fixture({ chain: 4 });
  g.selections = Array.from({ length: 3 }, () => ({ id: 'chain', tick: 0, time: 0 }) as never);
  g.xp = xpForLevel(200);
  const inner = g as unknown as { openChoice(): void; randomCards: { next(): number } };
  const open = (roll: number) => {
    inner.randomCards.next = () => roll;
    g.choice = null;
    inner.openChoice();
    return g.choice!.cards.find((card) => card.evolve);
  };
  return { g, open };
};

test('evolution cards need maximum rank and never follow from a run of misses', () => {
  const { g, open } = evolutionFixture();
  // Rank four never evolves, even on a winning roll.
  for (let i = 0; i < 20; i++) assert.equal(open(0), undefined);
  g.ranks.chain = 5;
  const chance = evolutionChance(g.boosts.luck);
  for (let i = 0; i < 20; i++) assert.equal(open(chance), undefined);
  for (let i = 0; i < 20; i++) assert.equal(open(0.99), undefined);
  const offered = open(chance / 2);
  assert.deepEqual([offered?.id, g.choice!.cards[0].evolve], ['chain', true]);
  assert.equal(g.automaticCard?.id, 'chain');
  g.choice!.cards = [{ id: 'chain', rarity: 'common', evolve: true }];
  assert.ok(g.select('chain'));
  assert.equal(g.evolved.chain, true);
  assert.equal(g.ranks.chain, 5);
  assert.equal(g.selections.at(-1)!.evolve, true);
  for (let i = 0; i < 20; i++) assert.equal(open(0), undefined);
});

test('a roll under the luck-raised chance offers an evolution, capped at the maximum chance', () => {
  const { g, open } = evolutionFixture();
  g.ranks.chain = 5;
  for (const luck of [0, 3, 1000]) {
    g.boosts.luck = luck;
    const chance = evolutionChance(luck);
    assert.ok(chance <= rules.evolution.maxChance);
    assert.equal(open(chance * 0.999)?.id, 'chain');
    assert.equal(open(chance), undefined);
  }
  assert.equal(evolutionChance(1000), rules.evolution.maxChance);
  assert.equal(open(rules.evolution.maxChance), undefined);
});

test('skills without an evolution never offer one', () => {
  const g = fixture({ repeat: 5 });
  g.selections = Array.from({ length: 3 }, () => ({ id: 'repeat', tick: 0, time: 0 }) as never);
  g.xp = xpForLevel(200);
  (g as unknown as { openChoice(): void }).openChoice();
  assert.equal(
    g.choice!.cards.some((card) => card.evolve),
    false,
  );
});

const damage = (ranks: Partial<Ranks>, evolved: boolean, run: (g: Game) => void, count = 4) => {
  const targets = Array.from({ length: count }, (_, i) => target(i, 180 + i * 10, 128, 1e6));
  const g = stationarySkill(ranks, targets);
  if (evolved) for (const id of Object.keys(ranks)) g.evolved[id as keyof Ranks] = true;
  run(g);
  return targets.reduce((sum, t) => sum + t.maxHp - t.hp, 0);
};

test('each evolution adds damage to the skill it changes', () => {
  const fire = (g: Game) => {
    g.combat.fireBasic(g.position);
  };
  for (const ranks of [{ chain: 5 }, { multi: 5 }] as Partial<Ranks>[])
    assert.ok(damage(ranks, true, fire) > damage(ranks, false, fire), Object.keys(ranks)[0]);
  const linger = (g: Game) => {
    g.combat.fireBasic(g.position);
    for (let i = 0; i < rules.tickRate; i++) {
      g.tick++;
      g.combat.update();
    }
  };
  assert.ok(damage({ pierce: 5 }, true, linger) > damage({ pierce: 5 }, false, linger));
  const total = (evolved: boolean) => {
    const g = stationarySkill({ satellite: 5 }, []);
    g.evolved.satellite = evolved;
    g.targets = Array.from({ length: 12 }, (_, i) => {
      const angle = (i * Math.PI) / 6;
      const { x, y } = g.position;
      return target(i, x + Math.cos(angle) * 18, y + Math.sin(angle) * 18, 1e6);
    });
    g.combat.fireSkill('satellite');
    return g.targets.reduce((sum, t) => sum + t.maxHp - t.hp, 0);
  };
  assert.ok(total(true) > total(false));
});

const pactGame = (...ids: PactId[]) => {
  const g = stationarySkill({}, []);
  for (const id of ids) {
    g.choice = { number: 1, opened: 0, deadline: 8, cards: [{ id, rarity: 'common' }] };
    assert.ok(g.select(id));
  }
  return g;
};

test('pacts are never picked automatically and a run takes at most three', () => {
  const g = fixture();
  g.choice = {
    number: 1,
    opened: 0,
    deadline: 8,
    cards: [
      { id: 'greed', rarity: 'common' },
      { id: 'range', rarity: 'common' },
    ],
  };
  assert.equal(g.automaticCard?.id, 'range');
  const full = pactGame('greed', 'gamble', 'blast');
  assert.equal(full.pactCount, rules.pacts.max);
  assert.equal(full.canUpgrade('quiet'), false);
  assert.equal(full.rank('greed'), 1);
});

test('pact gains and costs change combat as their cards say', () => {
  const hit = (g: Game, hp = 1e9) => {
    g.targets = [target(0, g.position.x + 10, g.position.y, hp)];
    g.combat.fireBasic();
    return hp - g.targets[0].hp;
  };
  const plain = hit(pactGame());
  // Gamble weakens normal hits; Blast weakens the hit but splashes.
  close(hit(pactGame('gamble')), plain * rules.pacts.gamble.normalScale);
  close(hit(pactGame('blast')), plain * rules.pacts.blast.damageScale);
  const horizon = pactGame('horizon');
  horizon.mass = 100;
  close(hit(horizon), plain * (1 + 100 * rules.pacts.horizon.damagePerMass));

  const greedy = pactGame('greed');
  for (let i = 0; i < 20; i++) {
    greedy.targets = [target(i, greedy.position.x + 10, greedy.position.y, 1)];
    greedy.combat.fireBasic();
  }
  assert.equal(greedy.xp, Math.floor(20 * (1 + rules.pacts.greed.xp)));

  const overclock = pactGame('overclock');
  overclock.mass = 200;
  assert.equal(overclock.recoverable, false);

  const pulse = pactGame('pulse');
  const mass = pulse.mass;
  pulse.resonate(0);
  assert.equal(pulse.mass, mass + rules.pacts.pulse.missMass);
  const calm = pactGame();
  calm.resonate(0);
  assert.equal(calm.mass, mass);
});

test('the quiet pact holds basic shots and releases them together', () => {
  const g = pactGame('quiet');
  const t = target(0, g.position.x + 10, g.position.y, 1e9);
  g.targets = [t];
  // Let the basic attack run, without spawns.
  g.combatEnabled = true;
  (g as unknown as { nextSpawn: number }).nextSpawn = Infinity;
  g.advance(rules.pacts.quiet.periodSeconds * 500);
  assert.equal(t.hp, 1e9);
  g.advance(rules.pacts.quiet.periodSeconds * 600);
  assert.ok(t.hp < 1e9);
});

test('pact cards appear on their interval, never in danger and at most once each', () => {
  const offers = (mass: number) => {
    const g = fixture({ repeat: 1, chain: 1 });
    g.mass = mass;
    g.selections = Array.from(
      { length: rules.pacts.interval - 1 },
      () => ({ id: 'power' }) as never,
    );
    g.xp = rules.levelXp[rules.pacts.interval];
    (g as unknown as { openChoice(): void }).openChoice();
    return g;
  };
  const safe = offers(0);
  const pact = safe.choice!.cards.find((card) => isPact(card.id));
  assert.ok(pact);
  assert.ok(safe.select(pact.id));
  assert.equal(safe.canUpgrade(pact.id), false);
  const danger = offers(1000);
  danger.radius = danger.core + 1;
  danger.choice = null;
  (danger as unknown as { openChoice(): void }).openChoice();
  assert.equal(
    danger.choice!.cards.some((card) => isPact(card.id)),
    false,
  );
});

test('checkpoints replay evolutions and pacts under current rules', () => {
  // Evolution is rare, so this seed is one whose run evolves a skill under current rules.
  const g = new Game(900001);
  playRhythm(g, (game) => {
    const cards = game.choice!.cards;
    return (
      cards.find((card) => card.evolve) ??
      cards.find((card) => isPact(card.id)) ??
      game.automaticCard!
    );
  });
  const checkpoint = createCheckpoint(g)!;
  const restored = restoreCheckpoint(structuredClone(checkpoint));
  assert.deepEqual(restored?.pacts, g.pacts);
  assert.deepEqual(restored?.evolved, g.evolved);
  assert.equal(restored?.xp, g.xp);
  assert.ok(Object.keys(g.evolved).length > 0, 'The run must evolve a skill');
  assert.ok(Object.keys(g.pacts).length > 0, 'The run must take a pact');
});

test('every language describes pacts, evolutions and event banners', () => {
  for (const { id } of languages) {
    const c = copy[id];
    for (const pact of pactIds) {
      const { gain, cost } = pactText(pact, id);
      assert.ok(gain.length && cost.length, pact);
      assert.ok(c.upgrades[pact].description.length);
    }
    for (const skill of skillIds)
      assert.ok(c.evolutions[skill].name && c.evolutions[skill].summary);
    assert.ok(c.banners.critical && c.banners.boss && c.banners['boss-down']);
    assert.ok(c.banners['final-boss'] && c.bossNames.higgs);
  }
});
