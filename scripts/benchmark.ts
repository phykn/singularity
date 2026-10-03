import assert from 'node:assert/strict';
import { sourceHash } from './engine.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Game } from '../src/game.ts';
import { isSkill, rules } from '../src/rules.ts';

const rows = [];
for (let seed = 1701; seed <= 1730; seed++) {
  const simulate = (fps: number) => {
    const g = new Game(seed); g.start();
    for (let i = 0; i < fps * 610 && !g.result; i++) g.advance(1000 / fps);
    assert.ok(g.result); return g;
  };
  const game = simulate(60), other = simulate(30);
  assert.deepEqual(game.result, other.result); assert.deepEqual(game.events, other.events);
  const first = game.selections[0], last = game.selections.at(-1);
  const firstVisible = first && isSkill(first.id) ? ['satellite', 'trail'].includes(first.id) ? first.time : game.skillActivations[first.id] : undefined;
  const gaps = game.selections.slice(1).map((s, i) => s.time - game.selections[i].time);
  if (last && game.nextXp !== undefined) gaps.push(game.collisionTime - last.time);
  const row = {
    seed, result: game.result!.outcome, trigger: game.result!.trigger,
    seconds: game.result!.seconds, collisionTime: game.collisionTime,
    xp: game.xp, mass: game.mass, ...game.metrics,
    firstChoice: first?.time ?? null, firstVisible: firstVisible ?? null,
    lastChoice: last?.time ?? null, choices: game.selections.length,
    lastUpgradeUse: last ? game.collisionTime - last.time : 0,
    maxChoiceGap: gaps.length ? Math.max(...gaps) : null,
    postMaxSeconds: game.nextXp === undefined && last ? game.collisionTime - last.time : 0,
    ranks: game.ranks, boosts: game.boosts, rarities: game.rarities, score: game.score, rushSpawns: game.rushSpawns, counts: game.result!.counts, selections: game.selections,
  };
  assert.ok(firstVisible !== undefined && firstVisible <= 25, 'Opening growth is too late');
  if (game.collisionTrigger === 'final') {
    assert.equal(game.level, 1 + rules.levelXp.filter(xp => xp <= game.xp).length);
    assert.ok(row.choices <= game.level - 1);
    if (game.result!.outcome === 'success') { assert.equal(row.choices, rules.levelXp.length); assert.ok(row.lastUpgradeUse >= 30); }
    assert.ok(row.maxChoiceGap! <= 90);
  }
  for (const event of game.events.filter(e => e.kind === 'level')) {
    const { level, xp } = event.data as { level: number; xp: number };
    assert.ok(xp >= rules.levelXp[level - 2]);
  }
  for (const kind of ['small', 'dense'] as const) {
    const c = row.counts[kind]; assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
  }
  rows.push(row);
}
// This small cohort checks replay; the separate balance cohort measures clear rate.
const summary = { runs: rows.length, successes: rows.filter(r => r.result === 'success').length };
console.table(rows.map(({seed,result,xp,mass,choices,minRadius}) => ({seed,result,xp,mass,choices,minRadius:minRadius.toFixed(1)})));
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/benchmark.json', JSON.stringify({ designVersion: rules.designVersion, sourceHash: sourceHash(), rules, seeds: [1701, 1730], runs: rows.length, fpsCompared: [30, 60], summary, rows }, null, 2));
console.log('30/60fps: all 30 results and events match; timing and conservation checks passed.');

