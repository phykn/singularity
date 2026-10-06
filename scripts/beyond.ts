import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Game } from '../src/game/Game.ts';
import { sourceHash } from './engine.ts';
import { rules } from '../src/game/rules.ts';

const count = Number(process.argv[2] ?? 300);
const start = Number(process.argv[3] ?? 108000);
const output = process.argv[4] ?? 'artifacts/beyond.json';
const rows = [];
for (let seed = start; seed < start + count; seed++) {
  const g = new Game(seed);
  g.start();
  g.advance(1800000);
  assert.ok(g.result);
  if (!g.canContinue) continue;
  const clear = structuredClone(g.result);
  g.continueBeyond();
  const from = g.events.length;
  g.advance(1800000);
  assert.ok(g.result?.endless, 'Endless bot run exceeded the observation window');
  assert.deepEqual(g.clearResult, clear);
  assert.ok(g.metrics.maxTargets <= rules.endless.maxTargets);
  for (const c of Object.values(g.result.counts))
    assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
  const first = g.events.slice(from).find((e) => e.kind === 'absorb');
  rows.push({
    seed,
    ...g.result.endless,
    maxTargets: g.metrics.maxTargets,
    firstAbsorption: first ? first.time - clear.collisionTime : null,
    dangerSeconds: g.metrics.dangerSeconds,
    ranks: g.ranks,
    rarities: g.rarities,
  });
  if (rows.length % 10 === 0)
    console.log(JSON.stringify({ checked: seed - start + 1, continuations: rows.length }));
}
const durations = rows.map((r) => r.seconds).sort((a, b) => a - b);
const summary = {
  normalRuns: count,
  continuations: rows.length,
  normalClearRate: rows.length / count,
  medianSeconds: durations[Math.floor(durations.length / 2)] ?? null,
  p90Seconds: durations[Math.floor(durations.length * 0.9)] ?? null,
  minSeconds: durations[0] ?? null,
  maxSeconds: durations.at(-1) ?? null,
  maxTargets: Math.max(0, ...rows.map((r) => r.maxTargets)),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceHash: sourceHash(),
      scope:
        'Highest-rarity automatic selection in normal and continued play; not a human survival estimate.',
      seeds: [start, start + count - 1],
      rules,
      summary,
      rows,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary));
