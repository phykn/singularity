import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(new URL('./rules.json', import.meta.url), 'utf8'));
assert.equal(r.designVersion, 7);
assert.equal(r.growthSeconds + r.collisionSeconds + r.successEndingSeconds, 600);
assert.equal(r.growthSeconds + r.collisionSeconds + r.failureEndingSeconds, 591);
assert.equal(r.levelXp.length, 25);
assert.equal(r.choiceCount, 3);
assert.equal(r.skillSlots, 4);
assert.equal(Object.keys(r.skills).length, 8);
assert.ok(r.levelXp.every((n, i, a) => n > 0 && (!i || a[i - 1] < n)));
assert.ok(r.levelXp.at(-1) < r.energyGoal);
assert.equal('firstChoiceGap' in r || 'choiceGap' in r, false);
assert.ok(r.waves.every((t, i, a) => t > r.waveWarningSeconds && t < r.growthSeconds && (!i || t > a[i - 1])));
const core = (m) => r.coreRadius + Math.min(r.coreGrowthMax, m * r.coreGrowth);
const radius = (m, a) => Math.max(0, Math.min(r.orbitRadius, r.orbitRadius + r.supportPerRank * a - r.gravityPerMass * m));
assert.equal(core(100), 18);
assert.equal(radius(100, 0), 67); assert.equal(radius(100, 1), 79);
assert.equal((radius(100, 1) - radius(100, 0)) / r.outwardSpeed, 2);
assert.ok(radius(170, 0) < core(170) + r.electronRadius);
assert.ok(radius(170, 1) > core(170) + r.electronRadius);
let offered = 0, batches = 0;
for (let tick = 0; tick < r.growthSeconds * r.tickRate;) {
  const stage = r.stageEnds.findIndex(t => tick < t * r.tickRate);
  const p = batches < r.introBatches ? 1 : r.smallBatchProbabilityByStage[stage];
  const scale = batches < r.introBatches ? 1 : r.batchScale[stage];
  offered += p * Math.round(r.smallBatchSize * scale) * r.targets.small.xp + (1 - p) * Math.round(r.denseBatchSize * scale) * r.targets.dense.xp;
  batches++; tick += r.spawnSecondsByStage[stage] * r.tickRate;
}
r.waves.forEach((_, i) => offered += 2 * (Math.round(r.waveSmall / 2 * r.waveScale[i]) * r.targets.small.xp + Math.round(r.waveDense / 2 * r.waveScale[i]) * r.targets.dense.xp));
assert.ok(offered > 2550 * 2.5);
assert.equal(Object.values(r.rarity).reduce((sum, entry) => sum + entry.chance, 0), 100);
for (let i = 0; i < r.stageEnds.length; i++) {
  assert.ok(r.rush.spawnSecondsByStage[i] < r.spawnSecondsByStage[i]);
  if (i) { assert.ok(r.batchScale[i] > r.batchScale[i - 1]); assert.ok(r.spawnSecondsByStage[i] < r.spawnSecondsByStage[i - 1]); }
}
assert.ok(r.levelXp.length <= (r.skillSlots + 1) * r.maxRank);
for (const data of Object.values(r.skills)) for (const array of Object.values(data)) {
  if (Array.isArray(array)) { assert.equal(array.length, r.maxRank + 1); assert.ok(array.every(Number.isFinite)); }
}
console.log(JSON.stringify({ status: 'passed', version: r.designVersion, totalSeconds: 600, levelXp: r.levelXp, batches, baseOfferedEnergy: offered, requiredEnergy: r.energyGoal, examples: { mass100: [radius(100,0),radius(100,1)], mass170: [radius(170,0),radius(170,1)] }, scope: 'Rule arithmetic; game and browser behavior are checked separately.' }, null, 2));

