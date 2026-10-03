import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(new URL('./rules.json', import.meta.url), 'utf8'));
assert.equal(r.designVersion, 6);
assert.equal(r.growthSeconds + r.collisionSeconds + r.successEndingSeconds, 600);
assert.equal(r.growthSeconds + r.collisionSeconds + r.failureEndingSeconds, 591);
assert.equal(r.levelXp.length, 12);
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
for (let tick = 0; tick < r.growthSeconds * r.tickRate; tick += r.spawnSeconds * r.tickRate) {
  const stage = r.stageEnds.findIndex((t) => tick < t * r.tickRate);
  const p = batches < r.introBatches ? 1 : r.smallBatchProbabilityByStage[stage];
  offered += p * r.smallBatchSize * r.targets.small.xp + (1 - p) * r.denseBatchSize * r.targets.dense.xp;
  batches++;
}
offered += r.waves.length * (r.waveSmall * r.targets.small.xp + r.waveDense * r.targets.dense.xp);
assert.equal(batches, 244); assert.equal(offered, 2550); assert.ok(r.energyGoal < (Math.ceil(r.growthSeconds / r.rush.spawnSeconds) * 10 + 110));
assert.equal(Object.values(r.rarity).reduce((sum, entry) => sum + entry.chance, 0), 100);
assert.ok(r.rush.spawnSeconds < r.spawnSeconds);
console.log(JSON.stringify({ status: 'passed', version: r.designVersion, totalSeconds: 600, levelXp: r.levelXp, batches, baseOfferedEnergy: offered, requiredEnergy: r.energyGoal, examples: { mass100: [radius(100,0),radius(100,1)], mass170: [radius(170,0),radius(170,1)] }, scope: 'Rule arithmetic; game and browser behavior are checked separately.' }, null, 2));

