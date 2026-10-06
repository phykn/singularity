import assert from 'node:assert/strict';
import { rules as r, levelForXp, xpForLevel } from '../src/game/rules.ts';
assert.equal('growthSeconds' in r, false);
assert.equal(r.choiceCount, 3);
assert.equal(r.skillSlots, 4);
assert.ok(r.rangeBonus > 0 && r.rangeBonus < 1);
assert.ok(r.rangeFalloff > 0);
assert.ok(r.recovery.minMass > 0 && r.recovery.mass >= r.recovery.minMass);
assert.ok(r.speedPerRank > 0);
assert.ok(r.introBatchSize > 0 && r.introBatches > 0);
assert.equal(Object.keys(r.skills).length, 16);
assert.ok(!('area' in r.skills) && !('whip' in r.skills) && !('wave' in r.skills));
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
