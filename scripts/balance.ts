import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Game } from '../src/game.ts';
import { rarityIds, rules } from '../src/rules.ts';

const start = 30000, count = 900, rows = [];
const sourceHash = createHash('sha256').update(readFileSync('src/game.ts')).update(readFileSync('src/rules.ts')).update(JSON.stringify(rules)).digest('hex');
const started = Date.now();
for (let seed = start; seed < start + count; seed++) {

  const g = new Game(seed); g.start(); g.advance(610000);
  assert.ok(g.result);
  for (const kind of ['small', 'dense'] as const) {
    const c = g.result.counts[kind];
    assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
  }
  assert.ok(g.result.seconds <= 600);
  const cards = g.events.filter(e => e.kind === 'cards').flatMap(e => (e.data as { cards: { rarity: string }[] }).cards);
  const offers = Object.fromEntries(rarityIds.map(id => [id, cards.filter(c => c.rarity === id).length]));
  rows.push({ seed, outcome: g.result.outcome, trigger: g.result.trigger, xp: g.xp, mass: g.mass, score: g.score, seconds: g.result.seconds, rushSpawns: g.rushSpawns, ...g.metrics, rarities: g.rarities, ranks: g.ranks, boosts: g.boosts, offers, selections: g.selections });
  if ((seed - start + 1) % 50 === 0) console.log(JSON.stringify({ seeds: seed - start + 1, games: rows.length, elapsedSeconds: (Date.now() - started) / 1000 }));
}
const summarize = (set: typeof rows) => ({
  games: set.length, wins: set.filter(r => r.outcome === 'success').length,
  clearRate: set.filter(r => r.outcome === 'success').length / set.length,
  earlyBefore180: set.filter(r => r.seconds < 180).length,
  finalConvergence: set.filter(r => r.trigger === 'final').length,
  maxTargets: Math.max(...set.map(r => r.maxTargets)), maxEffects: Math.max(...set.map(r => r.maxEffects)),
  medianRushSpawns: set.map(r => r.rushSpawns).sort((a,b) => a-b)[Math.floor(set.length / 2)],
});
const summary = summarize(rows);
const legendary = rows.filter(r => r.selections.some(s => s.rarity === 'legendary'));
const withoutLegendary = rows.filter(r => !r.selections.some(s => s.rarity === 'legendary'));
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/balance.json', JSON.stringify({ version: rules.designVersion, sourceHash, target: .2, calibrationSeeds: [[10000,10099]], validationSeeds: [start,start+count-1], summary, withLegendary: summarize(legendary), withoutLegendary: summarize(withoutLegendary), rules, rows }, null, 2));
console.log(JSON.stringify({ summary, withLegendary: summarize(legendary), withoutLegendary: summarize(withoutLegendary) }));

