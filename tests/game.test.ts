import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, maxDamageNumbers } from '../src/game.ts';
import { Random } from '../src/random.ts';
import { eligibleUpgrades, makeCards } from '../src/growth.ts';
import { effectOrigin, visibleEffects } from '../src/effects.ts';
import { orbit } from '../src/geometry.ts';
import legacy from './legacy-run.json' with { type: 'json' };
import type { Target, TargetKind } from '../src/game.ts';
import { blankBoosts, blankRanks, blankRarities, formValues, isSkill, rarityIds, rollRarity, rules, skillIds, statIds } from '../src/rules.ts';
import type { Boosts, Ranks, Rarity, UpgradeId } from '../src/rules.ts';
import { bestRecord, readLanguage, readRecord, readRun, readSettings, languageKey, recordKey, runKey, save, saveRun, settingsKey } from '../src/storage.ts';

const close = (a: number, b: number, error = 1e-7) => assert.ok(Math.abs(a - b) < error, a + ' != ' + b);
function target(id: number, x: number, y: number, hp = 2, kind: TargetKind = 'small'): Target {
  const data = rules.targets[kind];
  return { id, x, y, hp, maxHp: hp, kind, xp: data.xp, mass: data.mass, size: data.size, radius: Math.hypot(x - 180, y - 260), angle: Math.atan2(y - 260, x - 180), speed: 0, turn: 0 };
}
function fixture(ranks: Partial<Ranks> = {}, targets: Target[] = []): Game {
  const g = new Game(42, { combat: false }); g.start();
  Object.assign(g.ranks, ranks); g.targets = targets;
  for (const kind of ['small', 'dense'] as const) g.counts[kind].generated = targets.filter((t) => t.kind === kind).length;
  return g;
}
function choose(g: Game, id: UpgradeId, rarity: Rarity = 'common'): void {
  g.choice = { number: g.selections.length + 1, opened: g.time, deadline: g.time + 8, cards: [{ id, rarity }] };
  assert.ok(g.select(id));
}
function run(seed: number, fps: number): Game {
  const g = new Game(seed); g.start();
  for (let i = 0; i < fps * 610 && !g.result; i++) g.advance(1000 / fps);
  assert.ok(g.result); return g;
}

test('energy grants opportunities without automatic speed, fire rate or damage', () => {
  const g = fixture();
  const initial = [g.speed, g.damage, g.attackInterval];
  g.debugSetXp(2000);
  assert.deepEqual([g.speed, g.damage, g.attackInterval], initial);
  assert.equal(g.level, 1 + rules.levelXp.filter(xp => xp <= 2000).length); assert.equal(g.choice?.number, 1);
  assert.ok(g.choice!.cards.every(c => isSkill(c.id)));
  assert.ok(g.select(g.choice!.cards[0].id));
  assert.equal(g.level, 1 + rules.levelXp.filter(xp => xp <= 2000).length); assert.deepEqual([g.speed, g.damage, g.attackInterval], initial);
});

test('moving particles approach and death and absorption are mutually exclusive', () => {
  const p = target(0, 180, 90); p.speed = 7; p.turn = .12;
  const g = fixture({}, [p]); g.advance(1000);
  close(p.radius, 163); close(p.angle, -Math.PI / 2 + .12);
  assert.notEqual(p.x, 180);
  const killed = fixture({}, [target(0, 180, 275)]);
  killed.fireBasic({ x: 180, y: 275 }); killed.absorbTargets();
  assert.equal(killed.xp, 1); assert.equal(killed.mass, 0); assert.equal(killed.counts.small.absorbed, 0);
  const absorbed = fixture({}, [target(0, 180, 278, 100, 'dense')]);
  absorbed.fireBasic({ x: 180, y: 278 }); absorbed.absorbTargets(); absorbed.absorbTargets();
  assert.equal(absorbed.xp, 0); assert.equal(absorbed.mass, rules.targets.dense.mass);
  assert.equal(absorbed.counts.dense.absorbed, 1); assert.equal(absorbed.targets.length, 0);
});

test('acceleration recovers an orbit gradually without reducing accumulated mass', () => {
  const g = fixture(); g.mass = 80; g.advance(30000);
  assert.equal(g.phase, 'running'); assert.ok(g.radius < rules.orbitRadius);
  const before = g.radius, speed = g.speed;
  choose(g, 'accel');
  assert.ok(g.speed > speed); assert.equal(g.radius, before);
  g.advance(1000); close(g.radius, before + rules.outwardSpeed);
  g.advance(1000); close(g.radius, before + rules.supportPerRank);
  assert.equal(g.mass, 80);
  for (let i = 0; i < 36; i++) {
    const p = orbit(i * Math.PI / 18, g.radius);
    close(Math.hypot(p.x - 180, p.y - 260), g.radius);
  }
});

test('early collision snapshots the energy boundary and cancels combat and cards', () => {
  for (const xp of [rules.energyGoal - 1, rules.energyGoal]) {
    const g = fixture({ satellite: 3, trail: 3 }); g.debugSetXp(xp);
    g.mass = 1000; g.radius = g.core + rules.electronRadius + .01;
    g.advance(1000 / 60); assert.equal(g.phase, 'collapse'); assert.equal(g.choice, null);
    assert.equal(g.successfulEnding, xp >= rules.energyGoal);
    const frozen = { xp: g.xp, mass: g.mass, time: g.time };
    g.debugSetXp(100000); assert.equal(g.xp, xp);
    g.setManualPause(true); g.advance(10000); assert.equal(g.phaseProgress, 0);
    g.setManualPause(false); g.advance(3000); assert.equal(g.phase, 'ending');
    g.advance(12000); assert.ok(g.result);
    assert.deepEqual({ xp: g.xp, mass: g.mass, time: g.time }, frozen);
    assert.equal(g.result.trigger, 'gravity');
    assert.equal(g.result.outcome, xp >= rules.energyGoal ? 'success' : 'collapse-failure');
    assert.equal(g.events.some((e) => e.kind === 'hit' && e.time >= frozen.time), false);
  }
});

test('final convergence finishes in 600 or 591 seconds and never grants pending choices', () => {
  for (const xp of [rules.energyGoal - 1, rules.energyGoal]) {
    const g = fixture(); g.advance(584000); g.debugSetXp(xp);
    assert.ok(g.choice); const count = g.selections.length;
    g.advance(1000);
    assert.equal(g.phase, 'collapse'); assert.equal(g.time, 585); assert.equal(g.selections.length, count);
    g.advance(15000);
    assert.equal(g.result?.seconds, xp >= rules.energyGoal ? 600 : 591);
    assert.equal(g.result?.missingXp, xp >= rules.energyGoal ? 0 : 1);
    assert.equal(g.result?.trigger, 'final');
  }
});

test('contact at zero margin ends the run; a timely acceleration recovers a narrow orbit', () => {
  const unsafe = fixture(); unsafe.mass = 1000; unsafe.radius = unsafe.core + 4;
  unsafe.advance(1000 / 60); assert.equal(unsafe.phase, 'collapse');
  const recover = fixture();
  recover.mass = (rules.orbitRadius - 40) / rules.gravityPerMass;
  recover.radius = 40; choose(recover, 'accel'); recover.advance(2000);
  assert.equal(recover.phase, 'running'); close(recover.radius, 52);
});

test('XP alone levels up immediately, carries overflow, queues cards, and pauses every timer', () => {
  const g = fixture(); g.debugSetXp(rules.levelXp.at(-1)! + 3);
  const initial = structuredClone(g.choice);
  g.setManualPause(true); g.advance(20000); assert.deepEqual(g.choice, initial);
  assert.equal(g.select(g.choice!.cards[0].id), false);
  g.setHidden(true); g.setManualPause(false); g.advance(10000); assert.equal(g.time, 0);
  g.setManualPause(true); g.setHidden(false); g.advance(10000); assert.equal(g.time, 0);
  g.setManualPause(false); g.advance(8000);
  assert.equal(g.level, rules.levelXp.length + 1); assert.equal(g.selections.length, 1); assert.equal(g.choice?.number, 2); assert.equal(g.xp, rules.levelXp.at(-1)! + 3);
  g.advance((rules.levelXp.length - 1) * 8000);
  assert.equal(g.selections.length, rules.levelXp.length); assert.equal(g.choice, null);
  assert.deepEqual(g.selections.map((s) => s.time), Array.from({ length: rules.levelXp.length }, (_, i) => (i + 1) * 8));
  assert.equal(g.xp, rules.levelXp.at(-1)! + 3);
  const empty = fixture(); empty.advance(100000); assert.equal(empty.selections.length, 0); assert.equal(empty.choice, null);
  const boundary = fixture(); boundary.debugSetXp(rules.levelXp[0] - 1); boundary.advance(100000);
  assert.equal(boundary.level, 1); assert.equal(boundary.choice, null);
  boundary.debugSetXp(rules.levelXp[0]); assert.equal(boundary.level, 2); assert.equal(boundary.choice?.number, 1);
  assert.deepEqual(boundary.levelProgress, { current: 0, required: rules.levelXp[1] - rules.levelXp[0] });
  boundary.select(boundary.choice!.cards[0].id); boundary.debugSetXp(rules.levelXp[1] + 3);
  assert.equal(boundary.choice?.number, 2); assert.deepEqual(boundary.levelProgress, { current: 3, required: rules.levelXp[2] - rules.levelXp[1] });
});

test('every rank composition of four forms and three stats keeps three legal cards through the final choice', () => {
  let states = 0, minimum = Infinity;
  const ids = ['area', 'repeat', 'chain', 'pierce'] as const, base = rules.maxRank + 1;
  for (let bits = 0; bits < base ** ids.length; bits++) {
    let n = bits, spent = 0; const ranks = blankRanks();
    for (const id of ids) { ranks[id] = n % base; n = Math.floor(n / base); spent += ranks[id]; }
    for (let power = 0; power < base; power++) for (let rate = 0; rate < base; rate++) for (let accel = 0; accel < base; accel++) {
      const sum = spent + power + rate + accel; if (sum >= rules.levelXp.length) continue;
      const boosts: Boosts = { power, rate, accel }, eligible = eligibleUpgrades(ranks, boosts);
      const danger = sum % 2 === 0;
      const cards = makeCards({ ranks, boosts, number: sum + 1, danger }, new Random(9));
      assert.equal(cards.length, 3); assert.equal(new Set(cards).size, 3);
      cards.forEach(id => assert.ok(eligible.includes(id)));
      if (sum && danger && accel < rules.maxRank) assert.equal(cards[0], 'accel');
      if (sum && eligible.some(isSkill) && eligible.some(id => !isSkill(id))) {
        assert.ok(cards.some(isSkill)); assert.ok(cards.some(id => !isSkill(id)));
      }
      minimum = Math.min(minimum, eligible.length); states++;
    }
  }
  assert.ok(states > 250000); assert.equal(minimum, 3);
  // Fewer than three eligible types requires four full forms and one full stat.
  assert.ok(rules.levelXp.length <= (rules.skillSlots + 1) * rules.maxRank);
});

test('stale, double and expired card inputs cannot alter the next choice', () => {
  const g = fixture(); g.debugSetXp(2000);
  const choice = g.choice!;
  assert.ok(g.select(choice.cards[0].id, false, choice.number));
  assert.equal(g.select(choice.cards[0].id, false, choice.number), false);
  g.advance(25000); assert.ok(g.choice);
  assert.equal(g.select(g.choice!.cards[0].id, false, choice.number), false);
  g.advance(8000); assert.equal(g.selections.at(-1)?.automatic, true);
});

test('area and pierce share one damage hit, boundaries include the edge, and tie order is stable', () => {
  const origin = { x: 180, y: 128 };
  const g = fixture({ area: 1, pierce: 1 }, [target(0, 200, 128, 10), target(1, 220, 128, 10)]);
  g.fireBasic(origin); assert.deepEqual(g.targets.map((t) => t.hp), [8, 8]);
  const beam = fixture({ pierce: 1 }, [target(0, 190, 128, 10), target(1, 210, 134, 10), target(2, 210, 134.01, 10)]);
  beam.fireBasic(origin); assert.deepEqual(beam.targets.map((t) => t.hp), [8, 8, 10]);
  const edge = fixture({}, [target(1, 272, 128), target(2, 272.01, 128)]);
  edge.fireBasic(origin); assert.equal(edge.xp, 1); assert.equal(edge.targets[0].id, 2);
  const tie = fixture({}, [target(2, 180, 168), target(1, 220, 128)]);
  tie.fireBasic(origin); assert.equal(tie.targets[0].id, 2);
});

test('repeat follows moving targets, keeps reserved damage, and cancels dead primaries', () => {
  const p = target(0, 190, 128, 20); p.turn = .3;
  const g = fixture({ repeat: 1 }, [p]);
  g.fireBasic(); const first = g.effects.find((fx) => fx.kind === 'bolt')!;
  g.boosts.power = 3; g.ranks.repeat = 3; g.ranks.area = 3;
  g.advance(100);
  assert.equal(p.hp, 16);
  const second = g.effects.filter((fx) => fx.kind === 'bolt').at(-1)!;
  close(second.from.x, g.position.x); close(second.to.x, p.x);
  assert.notEqual(second.from.x, first.from.x); assert.notEqual(second.to.x, first.to.x);
  assert.equal(g.events.filter((e) => e.kind === 'hit').length, 2);
  const cancelled = fixture({ repeat: 3 }, [target(0, 180, 128), target(1, 215, 128)]);
  cancelled.fireBasic(); cancelled.advance(300); assert.equal(cancelled.xp, 1);
  assert.equal(cancelled.skillActivations.repeat, undefined);
});

test('satellites use global power, retarget, and do not activate other shapes', () => {
  const g = fixture({ satellite: 2, burst: 3, area: 3, multi: 3 }, [target(0, 190, 128, 3), target(1, 210, 128, 3), target(2, 230, 128, 3)]);
  g.boosts.power = 1; g.fireSatellites(); assert.equal(g.xp, 2);
  assert.equal(g.targets.length, 1); assert.equal(g.skillActivations.burst, undefined);
});

test('attack-speed upgrades preserve remaining satellite cooldown fraction', () => {
  const targets = Array.from({ length: 12 }, (_, id) => { const p = orbit(id * Math.PI / 6); return target(id, p.x, p.y, 1000); });
  const g = fixture({}, targets); choose(g, 'satellite'); g.advance(1000); choose(g, 'rate');
  g.advance(1900); assert.equal(g.skillActivations.satellite, undefined);
  g.advance(50);
  close(g.skillActivations.satellite!, 2.933333333333333, .001);
  const baseline = fixture({}, targets.map((t) => ({ ...t }))); choose(baseline, 'satellite');
  baseline.advance(3599); assert.equal(baseline.skillActivations.satellite, undefined);
  baseline.advance(1); close(baseline.skillActivations.satellite!, 3.6);
});

test('trail snapshots damage and rank, uses one target cooldown, and expires before damage', () => {
  const g = fixture({ trail: 1 }, [target(0, 190, 128, 10)]);
  g.leaveTrail(); g.leaveTrail(); g.boosts.power = 3; g.ranks.trail = 3;
  g.damageTrails(); assert.equal(g.targets[0].hp, 8);
  assert.equal(g.marks[0].rank, 1); assert.equal(g.marks[0].damage, 2);
  g.tick = 15; g.damageTrails(); assert.equal(g.targets[0].hp, 8);
  g.tick = 45; g.targets[0].trailHit = undefined; g.damageTrails(); assert.equal(g.targets[0].hp, 8);
  g.tick = 60; g.leaveTrail({ x: 180, y: 128 }); g.damageTrails(); assert.equal(g.targets[0].hp, 3);
});

test('chain triggers one burst per attack and burst kills never recurse', () => {
  const g = fixture({ burst: 2, multi: 3, repeat: 3 }, [0, 32, 64, 96].map((x, id) => target(id, 180 + x, 128)));
  g.fireBasic(); g.advance(300);
  assert.equal(g.xp, 3); assert.equal(g.effects.filter((fx) => fx.kind === 'burst').length, 1);
  const chain = fixture({ chain: 1, burst: 2 }, [target(0, 180, 128, 8), target(1, 212, 128), target(2, 244, 128), target(3, 212, 163)]);
  chain.fireBasic();
  assert.equal(chain.xp, 3); assert.equal(chain.targets[0].hp, 4);
  assert.equal(chain.effects.filter((fx) => fx.kind === 'burst').length, 1);
});

test('spread clears a small line, focus damages separated dense enemies faster', () => {
  const origin = { x: 180, y: 128 };
  const line = () => [0, 32, 64, 96, 128, 160].map((x, i) => target(i, origin.x + x, origin.y));
  const heavy = () => [[0, 0], [0, 70], [70, 0], [0, -70]].map(([x, y], i) => target(i, origin.x + x, origin.y + y, 16, 'dense'));
  const a = fixture({ area: 3, chain: 3 }, line()); a.fireBasic(origin);
  const b = fixture({ multi: 3, repeat: 3 }, line()); b.fireBasic(origin); b.advance(300);
  assert.equal(a.xp, 6); assert.equal(b.xp, 3);
  const c = fixture({ area: 3, chain: 3 }, heavy()); c.fireBasic(origin); c.advance(300);
  const d = fixture({ multi: 3, repeat: 3 }, heavy()); d.fireBasic(origin); d.advance(300);
  assert.ok(d.targets.reduce((sum, t) => sum + t.hp, 0) < c.targets.reduce((sum, t) => sum + t.hp, 0));
});

test('wave warnings precede the same spawn directions and stage changes do not alter existing HP', () => {
  const g = new Game(1701); g.start(); g.advance(87000);
  assert.equal(g.warningWave?.time, 90);
  const angle = g.warningWave!.angle;
  g.advance(3000); assert.equal(g.waveCount, 1); assert.equal(g.warningWave, null);
  const wave = g.events.find((e) => e.kind === 'wave')!.data as { angle: number };
  assert.equal(wave.angle, angle);
  const expected = g.events.filter((e) => e.kind === 'spawn' && e.time === 90).flatMap((e) => (e.data as { planned: Target[] }).planned);
  assert.equal(expected.length, rules.waveSmall + rules.waveDense);
  const h = fixture(); h.tick = 89 * 60; h.spawnBatch();
  const hp = h.targets.map((t) => t.maxHp);
  h.advance(2000); assert.deepEqual(h.targets.map((t) => t.maxHp), hp);
});

test('full games conserve particles and are identical at 30 and 60fps', () => {
  for (const seed of [1701, 1702, 1703]) {
    const a = run(seed, 30), b = run(seed, 60);
    assert.deepEqual(a.result, b.result); assert.deepEqual(a.events, b.events);
    for (const kind of ['small', 'dense'] as const) {
      const c = a.result!.counts[kind]; assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
    }
    assert.ok(a.result!.seconds <= 600);
  }
});

test('current records exclude older scores while preserving settings and safe storage failure', () => {
  const g = fixture(); g.debugSetXp(rules.energyGoal); g.advance(610000);
  const success = bestRecord(null, g.result!);
  assert.ok(success);
  const fail = { ...g.result!, outcome: 'collapse-failure' as const, xp: rules.energyGoal - 1 };
  assert.equal(bestRecord(success, fail), success);
  const improved = bestRecord(success, { ...g.result!, xp: rules.energyGoal + 1 });
  assert.ok(improved); assert.equal(improved.xp, rules.energyGoal + 1);
  const failedRecord = bestRecord(null, fail); assert.ok(failedRecord);
  assert.equal(bestRecord(failedRecord, { ...g.result!, version: 6, xp: 6000 }), failedRecord);
  assert.equal(bestRecord(null, { ...g.result!, version: 6 }), null);
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value) } as Storage;
  map.set('critical-point.record.v3', JSON.stringify({ outcome: 'success', xp: 100000 }));
  map.set(settingsKey, JSON.stringify({ sound: true, reduced: true }));
  assert.equal(readRecord(storage), null); assert.deepEqual(readSettings(storage), { sound: true, reduced: true });
  assert.ok(save(storage, recordKey, success)); assert.deepEqual(readRecord(storage), success);
  map.set(recordKey, JSON.stringify({ ...success, version: 3 })); assert.equal(readRecord(storage), null);
  map.set(recordKey, '{'); assert.equal(readRecord(storage), null);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
  assert.equal(save(blocked, recordKey, success), false); assert.equal(readRecord(blocked), null);
  assert.deepEqual(readSettings(blocked, true), { sound: false, reduced: true });
});

test('every lightning form can be offered from the first choice without a growth class', () => {
  const opening = new Set<UpgradeId>(), later = new Set<UpgradeId>();
  for (let seed = 0; seed < 512; seed++) {
    const random = new Random(seed), ranks = blankRanks(), boosts = blankBoosts();
    const cards = makeCards({ ranks, boosts, number: 1, danger: false }, random);
    cards.forEach((id) => opening.add(id));
    ranks.trail = 1;
    makeCards({ ranks, boosts, number: 2, danger: false }, random).forEach((id) => later.add(id));
  }
  assert.deepEqual(opening, new Set(skillIds));
  assert.deepEqual(later, new Set([...skillIds, ...statIds]));
  for (const id of skillIds) {
    const game = fixture();
    choose(game, id);
    assert.equal(game.rank(id), 1);
  }
});

test('language preferences persist, invalid or unavailable storage falls back to Korean', () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } } as Storage;
  assert.equal(readLanguage(storage), 'ko');
  for (const language of ['ko', 'en', 'zh', 'ja'] as const) {
    assert.ok(save(storage, languageKey, language));
    assert.equal(readLanguage(storage), language);
  }
  saved = '"fr"'; assert.equal(readLanguage(storage), 'ko');
  saved = '{'; assert.equal(readLanguage(storage), 'ko');
  assert.equal(readLanguage({ getItem: () => { throw new Error('blocked'); } } as unknown as Storage), 'ko');
});

test('damage numbers show calculated strikes including fractions and lethal overkill, and stop when paused', () => {
  const g = fixture({ repeat: 2 }, [target(0, 190, 128, 10)]);
  g.boosts.power = 1; g.rarities.power = 'epic';
  g.fireBasic({ x: 180, y: 128 });
  close(g.targets[0].hp, 10 - 3.45);
  assert.equal(g.damageNumbers[0].value, 3.45);
  g.advance(300);
  assert.equal(g.targets.length, 0);
  assert.deepEqual(g.damageNumbers.map(d => d.value), [3.45, 3.45, 3.45]);
  assert.equal(g.xp, 1);
  const frozen = structuredClone(g.damageNumbers);
  g.setHidden(true); g.advance(10000); assert.deepEqual(g.damageNumbers, frozen);
  g.setHidden(false); g.advance(800); assert.deepEqual(g.damageNumbers, []);
});

test('damage-number limits never reduce area hits, kills or XP', () => {
  const g = fixture({ area: 3 }, Array.from({ length: 100 }, (_, id) => target(id, 190, 128)));
  g.fireBasic({ x: 180, y: 128 });
  assert.equal(g.counts.small.killed, 100); assert.equal(g.xp, 100); assert.equal(g.targets.length, 0);
  assert.equal(g.damageNumbers.length, maxDamageNumbers);
  g.mass = 1000; g.radius = g.core + 4; g.advance(1000 / 60);
  assert.equal(g.phase, 'collapse'); assert.deepEqual(g.damageNumbers, []);
});

test('saved runs restore pending cards, moving enemies and reserved attacks with the same future', () => {
  for (const seed of [10000, 10004, 10017]) {
    const g = new Game(seed); g.start();
    for (let i = 0; i < 60 * 75 && g.phase === 'running'; i++) {
      g.advance(1000 / 60);
      if (g.choice && g.selections.length < 2) g.select(g.choice.cards[1].id);
    }
    const checkpoint = g.checkpoint()!;
    const restored = Game.restore(JSON.parse(JSON.stringify(checkpoint)))!;
    assert.ok(restored);
    for (const key of ['phase', 'tick', 'elapsedTicks', 'xp', 'mass', 'radius', 'angle', 'ranks', 'boosts', 'rarities', 'targets', 'marks', 'effects', 'damageNumbers', 'choice', 'selections', 'events'] as const) assert.deepEqual(restored[key], g[key], seed + ': ' + key);
    restored.advance(610000); g.advance(610000);
    assert.deepEqual(restored.result, g.result); assert.deepEqual(restored.events, g.events);
  }
});

test('save survives backgrounding and a reload, preserves manual pause, and quit discards the run', () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) } as Storage;
  const g = new Game(10004); g.start();
  for (let i = 0; i < 1800 && !g.choice; i++) g.advance(1000 / 60);
  assert.ok(g.choice); g.setManualPause(true); g.setHidden(true);
  assert.ok(saveRun(storage, g)); assert.ok(map.get(runKey)!.length < 2000);
  const restored = readRun(storage)!;
  assert.ok(restored.manualPaused); assert.equal(restored.hiddenPaused, false);
  assert.deepEqual(restored.choice, g.choice); assert.equal(restored.time, g.time);
  restored.advance(10000); assert.equal(restored.time, g.time);
  restored.setManualPause(false); g.setManualPause(false); g.setHidden(false);
  restored.advance(610000); g.advance(610000); assert.deepEqual(restored.result, g.result);
  assert.ok(saveRun(storage, restored)); assert.deepEqual(readRun(storage)?.result, restored.result);
  assert.ok(saveRun(storage, new Game(g.seed))); assert.equal(readRun(storage), null);
});

test('ending phases resume at the same frame after saving; bad or incompatible saves do not load', () => {
  const full = run(10004, 60);
  const collisionTick = Math.round(full.collisionTime * rules.tickRate);
  for (const extra of [0, 60, 210, 900]) {
    const g = new Game(10004); g.start(); g.advance((collisionTick + extra) * 1000 / rules.tickRate);
    const restored = Game.restore(g.checkpoint()!)!;
    assert.ok(restored); assert.equal(restored.phase, g.phase); assert.equal(restored.phaseProgress, g.phaseProgress);
    g.advance(16000); restored.advance(16000); assert.deepEqual(restored.result, g.result);
  }
  const g = new Game(10004); g.start(); g.advance(123000);
  const checkpoint = g.checkpoint()!;
  const values = [null, {}, '{', { ...checkpoint, version: 5 }, { ...checkpoint, ticks: -1 }, { ...checkpoint, ticks: 36001 }, { ...checkpoint, inputs: [{ tick: 1, id: 'unknown', number: 1 }] }, { ...checkpoint, inputs: [{ tick: 1, id: 'area', number: 1 }] }];
  for (const value of values) {
    const storage = { getItem: () => typeof value === 'string' ? value : JSON.stringify(value) } as Storage;
    assert.equal(readRun(storage), null);
  }
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } } as unknown as Storage;
  assert.equal(readRun(blocked), null); assert.equal(saveRun(blocked, g), false); assert.equal(saveRun(blocked, new Game(1)), false);
});


test('all eight forms change their actual hit coverage at every rank', () => {
  const origin = { x: 180, y: 128 };
  const line = (xs: number[], hp = 2) => xs.map((x, id) => target(id, origin.x + x, origin.y, hp));
  for (const rank of [1, 2, 3]) {
    for (const id of ['area', 'burst'] as const) {
      const g = fixture({ [id]: rank }, line([0, 24, 34, 46]));
      g.fireBasic(origin); assert.equal(g.xp, rank + 1, id);
    }
    const repeat = fixture({ repeat: rank }, line([0], 8));
    repeat.fireBasic(origin); repeat.advance(300);
    assert.equal(repeat.targets[0]?.hp ?? 0, 8 - 2 * (rank + 1));
    const multi = fixture({ multi: rank }, [[40, 0], [-40, 0], [0, 40], [0, -40]].map(([x, y], id) => target(id, origin.x + x, origin.y + y)));
    multi.fireBasic(origin); assert.equal(multi.xp, rank + 1);
    const chain = fixture({ chain: rank }, line([0, 40, 80, 120, 160, 200]));
    chain.fireBasic(origin); assert.equal(chain.xp, [0, 3, 5, 6][rank]);
    const pierce = fixture({ pierce: rank }, line([20, 80, 130, 180, 230]));
    pierce.fireBasic(origin); assert.equal(pierce.xp, rank + 2);
    const satellite = fixture({ satellite: rank }, line([10, 20, 30]));
    satellite.fireSatellites(); assert.equal(satellite.xp, rank);
    const trail = fixture({ trail: rank }, line([12, 16, 20]));
    trail.leaveTrail(origin); trail.damageTrails(); assert.equal(trail.xp, rank);
    assert.equal(trail.marks[0].expires, [.0, .75, 1, 1.25][rank]);
  }
});

test('an attack build can win without acceleration and manual inputs replay at 30/60fps', () => {
  const a = new Game(10000); a.start();
  const order: UpgradeId[] = ['area', 'repeat', 'chain', 'power', 'rate', 'multi', 'burst', 'satellite', 'pierce', 'trail'];
  const inputs: { tick: number; id: UpgradeId }[] = [];
  while (!a.result) {
    a.advance(1000 / 30);
    if (a.choice) {
      const id = a.choice.cards.map(c => c.id).filter((id) => id !== 'accel').sort((x, y) => order.indexOf(x) - order.indexOf(y))[0];
      inputs.push({ tick: a.tick, id }); assert.ok(a.select(id));
    }
  }
  assert.equal(a.result.outcome, 'success'); assert.equal(a.boosts.accel, 0);
  assert.equal(a.selections.length, rules.levelXp.length);
  const b = new Game(10000); b.start(); let index = 0;
  while (!b.result) {
    b.advance(1000 / 60);
    if (index < inputs.length && inputs[index].tick === b.tick) {
      assert.ok(b.select(inputs[index].id)); index++;
    }
  }
  assert.equal(index, inputs.length);
  assert.deepEqual(a.events, b.events); assert.deepEqual(a.result, b.result);
});


test('rarity roll boundaries and seeded base frequencies match published odds', () => {
  let edge = 0;
  for (const id of rarityIds) {
    assert.equal(rollRarity(edge / 100), id);
    edge += rules.rarity[id].chance;
    assert.equal(rollRarity((edge - .00001) / 100), id);
  }
  const random = new Random(3189), counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (let i = 0; i < 100000; i++) counts[rollRarity(random.next())]++;
  for (const id of rarityIds) close(counts[id] / 1000, rules.rarity[id].chance, .5);
});

test('rarity persists through lower-quality upgrades and improves real damage and orbit support', () => {
  const g = fixture({}, [target(0, 190, 128, 20)]);
  choose(g, 'power', 'legendary'); g.fireBasic();
  close(g.targets[0].hp, 16.2);
  choose(g, 'power', 'common'); assert.equal(g.rarities.power, 'legendary');
  g.fireBasic(); close(g.targets[0].hp, 10.6);
  choose(g, 'accel', 'legendary'); g.mass = 100; g.advance(30000);
  close(g.radius, 88.6); close(g.speed, 231); assert.equal(g.mass, 100);
  g.debugSetXp(10000); g.advance(50000);
  for (const card of g.choice?.cards ?? []) assert.ok(rarityIds.indexOf(card.rarity) >= rarityIds.indexOf(g.rarities[card.id]));
});

test('all four rarities change actual geometry or hit counts across the eight forms', () => {
  const origin = { x: 180, y: 128 };
  const line = (xs: number[], hp = 2) => xs.map((x, id) => target(id, origin.x + x, origin.y, hp));
  for (let tier = 0; tier < 4; tier++) {
    const rarity = rarityIds[tier];
    for (const [id, xs] of [['area', [0, 32, 39, 48]], ['burst', [0, 26, 32, 40]]] as const) {
      const g = fixture({ [id]: 1 }, line([...xs])); g.rarities[id] = rarity;
      g.fireBasic(origin); assert.equal(g.xp, tier + 1, id + rarity);
    }
    const repeat = fixture({ repeat: 1 }, line([0], 20)); repeat.rarities.repeat = rarity;
    repeat.fireBasic(origin); repeat.advance(700); assert.equal(repeat.targets[0].hp, 20 - (tier + 2) * 2);
    const multi = fixture({ multi: 1 }, line([10, 20, 30, 40, 50])); multi.rarities.multi = rarity;
    multi.fireBasic(origin); assert.equal(multi.xp, tier + 2);
    const chain = fixture({ chain: 1 }, line([0, 40, 80, 120, 160, 200, 240, 280, 320])); chain.rarities.chain = rarity;
    chain.fireBasic(origin); assert.equal(chain.xp, 3 + tier * 2);
    const pierce = fixture({ pierce: 1 }, line([20, 150, 190, 240])); pierce.rarities.pierce = rarity;
    pierce.fireBasic(origin); assert.equal(pierce.xp, tier + 1);
    const satellite = fixture({ satellite: 1 }, line([10, 20, 30, 40])); satellite.rarities.satellite = rarity;
    satellite.fireSatellites(origin); assert.equal(satellite.xp, tier + 1);
    const trail = fixture({ trail: 1 }, line([12, 16, 20, 24])); trail.rarities.trail = rarity;
    trail.leaveTrail(origin); trail.damageTrails(); assert.equal(trail.xp, tier + 1);
  }
});

test('reserved pulses and trails keep their original rarity geometry', () => {
  const g = fixture({ repeat: 1, area: 1 }, [target(0, 180, 128, 20), target(1, 226, 128, 20)]);
  g.fireBasic(); g.rarities.repeat = 'legendary'; g.rarities.area = 'legendary';
  g.advance(700);
  assert.equal(g.targets[0].hp, 16); assert.equal(g.targets[1].hp, 20);
  const h = fixture({ trail: 1 }, [target(0, 200, 128)]);
  h.leaveTrail(); h.rarities.trail = 'legendary'; h.damageTrails();
  assert.equal(h.xp, 0); h.leaveTrail(); h.damageTrails(); assert.equal(h.xp, 1);
});

test('fast clear brings the next batch sooner, crowding stops acceleration, and score only rewards kills', () => {
  const fast = new Game(1); fast.ranks.area = 3; fast.ranks.chain = 3; fast.start();
  fast.fireBasic(fast.targets[4]);
  fast.fireBasic(fast.targets[0]);
  assert.ok(fast.rushing); assert.equal(fast.xp, 8);
  const generated = fast.counts.small.generated + fast.counts.dense.generated;
  fast.advance(800);
  assert.ok(fast.counts.small.generated + fast.counts.dense.generated > generated);
  assert.ok(fast.rushSpawns > 0); assert.ok(fast.score > 0);
  const ordinary = new Game(1); ordinary.start(); ordinary.advance(800);
  assert.equal(ordinary.counts.small.generated + ordinary.counts.dense.generated, generated);
  const crowded = fixture({ multi: 3 }, Array.from({ length: 50 }, (_, id) => target(id, 181 + id, 128)));
  crowded.fireBasic(); crowded.fireBasic();
  assert.equal(crowded.xp, 8); assert.equal(crowded.targets.length, 42); assert.equal(crowded.rushing, false);
  const absorbed = fixture({}, [target(0, 180, 275)]);
  absorbed.absorbTargets(); assert.equal(absorbed.score, 0);
  const early = fixture({}, [target(0, 180, 128)]), late = fixture({}, [target(0, 180, 278)]);
  early.fireBasic(early.targets[0]); late.fireBasic(late.targets[0]);
  assert.ok(early.score > late.score);
});


test('fractional rarity damage resolves exact lethal totals without a phantom last hit', () => {
  const g = fixture({}, [target(0, 180, 128, 16, 'dense')]);
  g.boosts.power = 1; g.rarities.power = 'rare';
  for (let i = 0; i < 5; i++) g.fireBasic();
  assert.equal(g.targets.length, 0); assert.equal(g.xp, 5);
  const h = fixture({}, [target(0, 180, 128, 44, 'dense')]);
  h.boosts.power = 2; h.rarities.power = 'rare';
  for (let i = 0; i < 10; i++) h.fireBasic();
  assert.equal(h.targets.length, 0); assert.equal(h.xp, 5);
});


test('v6 saves migrate without changing the manual build or its final result, and quitting clears both keys', () => {
  const data = new Map<string, string>([['singularity.run.v6', JSON.stringify(legacy.checkpoint)]]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } as unknown as Storage;
  const game = readRun(storage); assert.ok(game); assert.equal(game.rules.designVersion, 6);
  for (const [key, value] of Object.entries(legacy.current)) assert.deepEqual(game[key as keyof Game], value);
  assert.ok(saveRun(storage, game)); assert.equal(data.has('singularity.run.v6'), false);
  const restored = readRun(storage); assert.ok(restored); restored.advance(610000);
  assert.deepEqual(restored.result, legacy.result);
  assert.ok(saveRun(storage, new Game(42))); assert.equal(readRun(storage), null);
});

test('later stages increase group size, wave size and intake rate without changing existing enemy HP', () => {
  const first = new Game(42, { combat: false }); first.start();
  const late = new Game(42, { combat: false }); late.start(); late.tick = 451 * rules.tickRate;
  for (let i = 0; i < 3; i++) { first.spawnBatch(); late.spawnBatch(); }
  first.targets = []; late.targets = [];
  for (let i = 0; i < 20; i++) { first.spawnBatch(); late.spawnBatch(); }
  assert.ok(late.targets.length > first.targets.length * 3);
  assert.ok(rules.spawnSecondsByStage[4] < rules.spawnSecondsByStage[0]);
  assert.ok(rules.rush.spawnSecondsByStage[4] < rules.rush.spawnSecondsByStage[0]);
  assert.equal(late.targets[0].hp, rules.targets.small.hp[4]);
});

test('ranks four and five improve actual hit coverage for all forms while preserving four slots', () => {
  const origin = { x: 180, y: 128 };
  const line = (xs: number[], hp = 2) => xs.map((x, i) => target(i, origin.x + x, origin.y, hp));
  for (const rank of [4, 5]) {
    for (const [id, xs] of [['area', [0, 60, 76]], ['burst', [0, 55, 68]]] as const) {
      const game = fixture({ [id]: rank }, line([...xs])); game.fireBasic(origin);
      assert.equal(game.xp, rank === 4 ? 2 : 3);
    }
    const repeat = fixture({ repeat: rank }, line([0], 20)); repeat.fireBasic(origin); repeat.advance(600);
    assert.equal(repeat.targets[0].hp, rank === 4 ? 10 : 8);
    const multi = fixture({ multi: rank }, line([10, 20, 30, 40, 50, 60])); multi.fireBasic(origin);
    assert.equal(multi.xp, rank + 1);
    const chain = fixture({ chain: rank }, line(Array.from({ length: 10 }, (_, i) => i * 60))); chain.fireBasic(origin);
    assert.equal(chain.xp, rank === 4 ? 8 : 10);
    const pierce = fixture({ pierce: rank }, line([20, 280, 320])); pierce.fireBasic(origin);
    assert.equal(pierce.xp, rank === 4 ? 2 : 3);
    const satellite = fixture({ satellite: rank }, line([10, 20, 30, 40, 50])); satellite.fireSatellites(origin);
    assert.equal(satellite.xp, rank);
    const trail = fixture({ trail: rank }, line([10, 25, 29])); trail.leaveTrail(origin); trail.damageTrails();
    assert.equal(trail.xp, rank === 4 ? 2 : 3);
  }
  const game = fixture(); game.debugSetXp(rules.levelXp.at(-1)!);
  game.advance(rules.levelXp.length * rules.choiceSeconds * 1000);
  assert.equal(game.level, 26); assert.equal(game.selections.length, 25); assert.equal(game.choice, null);
  assert.ok(skillIds.filter(id => game.ranks[id]).length <= 4);
});

test('lightning follows the live electron and satellites while chain links keep their hit origins', () => {
  const game = fixture({ chain: 1, satellite: 2 }, [target(0, 190, 128, 100), target(1, 218, 128, 100)]);
  game.fireBasic(); game.fireSatellites();
  const bolt = game.effects.find(fx => fx.kind === 'bolt' && !fx.source)!;
  const chain = game.effects.find(fx => fx.source === 'chain')!;
  const satellite = game.effects.find(fx => fx.source === 'satellite')!;
  game.advance(100);
  assert.notDeepEqual(game.position, bolt.from);
  assert.deepEqual(effectOrigin(bolt, game.position, game.seconds), game.position);
  assert.deepEqual(effectOrigin(chain, game.position, game.seconds), chain.from);
  const point = effectOrigin(satellite, game.position, game.seconds);
  close(Math.hypot(point.x - game.position.x, point.y - game.position.y), 15);
  assert.ok(bolt.life <= .14); assert.ok(satellite.life <= .14);
});

test('dense kills retain the emitting bolt within the effect budget', () => {
  const game = fixture({ area: 5 }, Array.from({ length: 240 }, (_, i) => target(i, 180 + i % 20, 128)));
  game.fireBasic();
  assert.equal(game.xp, 240); assert.equal(game.effects.length, 160);
  assert.ok(game.effects.some(fx => fx.kind === 'bolt' && fx.anchor === 'electron'));
});

test('effect display limits preserve emitting lightning while reducing kill and area clutter', () => {
  const game = fixture({ area: 5, multi: 5, chain: 5 }, Array.from({ length: 240 }, (_, i) => target(i, 180 + i % 20, 128, 4)));
  game.fireBasic();
  const before = { xp: game.xp, targets: game.targets.length, effects: game.effects.length };
  const normal = visibleEffects(game.effects, false), reduced = visibleEffects(game.effects, true);
  assert.ok(normal.some(fx => fx.anchor === 'electron'));
  assert.ok(normal.filter(fx => fx.kind === 'kill').length <= 10);
  assert.ok(normal.filter(fx => fx.kind === 'area').length <= 4);
  assert.ok(reduced.filter(fx => fx.kind === 'kill').length <= 3);
  assert.deepEqual({ xp: game.xp, targets: game.targets.length, effects: game.effects.length }, before);
});
