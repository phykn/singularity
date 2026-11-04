import assert from 'node:assert/strict';
import { rules as r, levelForXp, xpForLevel } from '../src/game/rules.ts';
assert.equal('growthSeconds' in r, false);
assert.equal(r.choiceCount, 3);
assert.equal(r.skillSlots, 4);
assert.ok(r.rangeBonus > 0 && r.rangeBonus < 1);
assert.ok(r.rangeFalloff > 0);
assert.ok(r.recovery.minMass > 0 && r.recovery.mass >= r.recovery.minMass);
assert.ok(r.powerBonus > 0 && r.powerFalloff > 0);
// Power grows gently: the first rank stays under double damage.
assert.ok(1 + r.powerBonus / (r.powerFalloff + 1) < 2);
assert.ok(r.crit.perRank > 0 && r.crit.max <= 0.5 && r.crit.multiplier > 1);
assert.ok(r.luck.rarityShift > 0 && r.luck.rarityShift * 10 < r.rarity.common.chance);
assert.ok(r.introBatchSize > 0 && r.introBatches > 0);
assert.equal(Object.keys(r.skills).length, 16);
for (const removed of ['focus', 'repel', 'gather', 'chase', 'bridge', 'vent'])
  assert.ok(!(removed in r.skills));
// Every skill evolves.
for (const id of Object.keys(r.skills)) assert.ok(id in r.evolution, id);
assert.ok(r.levelXp.every((n, i, a) => n > 0 && (!i || a[i - 1] < n)));
assert.ok(r.levelXpStep > 0);
for (const level of [2, 26, 27, 50, 100]) {
  assert.equal(levelForXp(xpForLevel(level)), level);
  assert.equal(levelForXp(xpForLevel(level) - 1), level - 1);
}
assert.equal(r.stageStarts[0], 0);
assert.ok(r.stageStarts.every((n, i, a) => !i || a[i - 1] < n));
assert.ok(r.waves.every((t, i, a) => t > r.waveWarningSeconds && (!i || t > a[i - 1])));
assert.ok(r.waveRepeatSeconds > r.waveWarningSeconds);
assert.equal(r.waves.at(-1), r.stageStarts.at(-1));
assert.ok(r.late.assaultSeconds > 0 && r.late.recoverySeconds > 0);
assert.ok(
  r.late.assaultSeconds + r.late.recoverySeconds < r.waveRepeatSeconds - r.waveWarningSeconds,
);
assert.ok(r.late.hpPerMinute > 0 && r.late.speedPerMinute > 0);
assert.ok(r.late.maxSpeedScale > 1 && r.late.recoverySpawnScale > 1);
assert.ok(r.endless.entrySeconds > 0);
assert.ok(r.endless.hpMultiplier > 1 && r.endless.speedStep > 0 && r.endless.maxSpeedScale > 1);
assert.ok(
  r.endless.cycleSeconds >
    r.waveWarningSeconds + r.endless.assaultSeconds + r.endless.recoverySeconds,
);
assert.ok(Number.isInteger(r.endless.maxTargets) && r.endless.maxTargets > 0);
for (const p of [r.late.smallBatchProbability, r.late.muonProbability, r.late.neutronProbability])
  assert.ok(p > 0 && p < 1);
assert.equal(
  Object.values(r.rarity).reduce((sum, entry) => sum + entry.chance, 0),
  100,
);
for (const values of [
  r.smallBatchProbabilityByStage,
  r.batchScale,
  r.spawnSecondsByStage,
  r.rush.spawnSecondsByStage,
  r.rush.maxTargetsByStage,
  ...Object.values(r.targets).map((t) => t.hp),
])
  assert.equal(values.length, r.stageStarts.length);
for (let i = 0; i < r.stageStarts.length; i++) {
  assert.ok(r.rush.spawnSecondsByStage[i] < r.spawnSecondsByStage[i]);
  if (i) {
    assert.ok(r.batchScale[i] > r.batchScale[i - 1]);
    assert.ok(r.spawnSecondsByStage[i] < r.spawnSecondsByStage[i - 1]);
  }
}
for (const data of Object.values(r.skills))
  for (const array of Object.values(data)) {
    if (Array.isArray(array)) {
      assert.equal(array.length, r.maxRank + 1);
      assert.ok(array.every(Number.isFinite));
    }
  }
assert.ok(r.critical.energyFraction > 0 && r.critical.energyFraction < 1);
assert.ok(r.boss.stages.length > 0);
assert.ok(
  r.boss.stages.every(
    (s, i, a) =>
      s.energyFraction > 0 &&
      s.energyFraction < 1 &&
      (!i || s.energyFraction > a[i - 1].energyFraction) &&
      s.hp > 0 &&
      s.xp > 0 &&
      s.mass > 0 &&
      s.summonCount > 0 &&
      (!i || s.hp > a[i - 1].hp),
  ),
);
assert.ok(r.boss.final.hp > r.boss.stages.at(-1).hp);
assert.ok(
  r.boss.slotKills.every(
    (n, i, a) => Number.isInteger(n) && n > 0 && n <= r.boss.stages.length && (!i || n > a[i - 1]),
  ),
);
assert.ok(r.boss.final.speed > 0 && r.boss.final.size > r.boss.size);
// Each giant particle has its own rule, and the Higgs field widens near the end.
assert.deepEqual(
  r.boss.stages.map((s) => s.kind),
  ['gluon', 'w', 'z', 'tau', 'top'],
);
const b = r.boss.behaviors;
assert.ok(b.gluon.tethered > 0 && b.gluon.damageScale > 0 && b.gluon.damageScale < 1);
assert.ok(b.w.seconds > 0 && b.w.radius > 0 && b.w.count > 0);
assert.ok(b.z.immuneSeconds + b.z.warnSeconds < b.z.period);
assert.ok(b.tau.chargeSeconds + b.tau.dashSeconds < b.tau.cycle && b.tau.dashSpeed > 1);
assert.ok(b.top.speed > 0 && b.top.speed < 1);
const field = r.boss.final.field;
assert.ok(field.wideRadius > field.radius && field.wideFraction > 0 && field.wideFraction < 1);
assert.ok(field.speed < 1 && field.hp > 1 && field.mass > 1);
// Particle mixes cover every stage and leave room for quarks and protons.
const p = r.particles;
for (const key of ['muon', 'neutrino', 'meson', 'neutron'])
  assert.equal(p[key].length, r.stageStarts.length);
for (let i = 0; i < r.stageStarts.length; i++) {
  assert.ok(p.muon[i] + p.neutrino[i] + p.meson[i] < 1);
  assert.ok(p.neutron[i] < 1);
}
assert.ok(r.late.muonProbability + Math.max(...p.neutrino) + Math.max(...p.meson) < 1);
assert.ok(p.quarkPack.size[0] >= 1 && p.quarkPack.size[1] >= p.quarkPack.size[0]);
assert.ok(p.heavy.mass > r.targets.dense.mass && p.heavy.speed < 1 && p.split.quarks > 0);
// Formations unlock by stage, the first on stage one.
const f = r.formations;
assert.ok(f.chance > 0 && f.chance < 1 && f.previewSeconds > 0 && f.minCount >= 3);
assert.equal(Math.min(...Object.values(f.stages)), 0);
assert.ok(Object.values(f.stages).every((s) => s < r.stageStarts.length));
assert.ok(f.previewSeconds < r.waveWarningSeconds);
assert.ok(r.critical.pull > 0 && r.critical.spawnScale > 0 && r.critical.spawnScale < 1);
assert.ok(r.critical.xpScale > 0 && r.critical.xpScale <= 1);
assert.ok(r.critical.hpScale >= 1 && r.critical.speedScale >= 1);
assert.ok(r.boss.speed > 0 && r.boss.size > 0);
assert.ok(Math.round(r.boss.feedSeconds * r.tickRate) > 0);
for (const fractions of [r.boss.summonFractions, r.boss.final.summonFractions])
  assert.ok(fractions.every((n, i, a) => n > 0 && n < 1 && (!i || n < a[i - 1])));
assert.ok(r.evolution.chance > 0 && r.evolution.chance <= r.evolution.maxChance);
assert.ok(r.evolution.maxChance < 1 && r.evolution.luckChance > 0);
assert.ok(Number.isInteger(r.evolution.pity) && r.evolution.pity > 0);
assert.ok(r.evolution.pierce.trailInterval < r.evolution.pierce.trailSeconds);
assert.ok(Number.isInteger(r.pacts.interval) && r.pacts.interval > 1);
assert.equal(r.pacts.max, 3);
// Pop rhythms: taps one by one, bursts at once, dominoes slower than taps,
// a release tighter than taps, and sweeps along their line.
assert.deepEqual(Object.keys(r.pops), ['tap', 'burst', 'domino', 'release', 'sweep']);
assert.equal(r.pops.burst.stagger, 0);
assert.ok(r.pops.burst.debris > 1);
assert.ok(r.pops.domino.stagger > r.pops.tap.stagger);
assert.ok(r.pops.release.stagger < r.pops.tap.stagger);
assert.ok(r.pops.sweep.speed > 0 && r.pops.sweep.max > 0);
for (const style of ['tap', 'burst', 'domino', 'release'])
  assert.ok(r.pops[style].max >= r.pops[style].stagger);
assert.deepEqual(
  Object.keys(r.pacts).filter((k) => typeof r.pacts[k] === 'object'),
  ['overheat', 'blast', 'greed', 'quiet', 'overclock', 'pulse', 'gamble', 'horizon'],
);
assert.ok(r.pacts.blast.damageScale < 1 && r.pacts.gamble.normalScale < 1);
assert.ok(r.pacts.gamble.critMultiplier > r.crit.multiplier);
assert.ok(r.bannerSeconds > 0);
console.log(
  JSON.stringify({
    status: 'passed',
    timeLimit: null,
    levelLimit: null,
    statRankLimit: null,
    skillRankLimit: r.maxRank,
    requiredEnergy: r.energyGoal,
    scope: 'Rule arithmetic; game and browser behavior are checked separately.',
  }),
);
