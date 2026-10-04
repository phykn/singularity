import assert from 'node:assert/strict';
import { sourceHash } from './engine.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Game } from '../src/game.ts';
import { rarityIds, rules } from '../src/rules.ts';

const count = Number(process.argv[2] ?? 900), start = Number(process.argv[3] ?? 92000), rows = [];
const started = Date.now();
for (let seed = start; seed < start + count; seed++) {

  const g = new Game(seed); g.start(); g.advance(1800000);
  assert.ok(g.result);
  for (const c of Object.values(g.result.counts)) {
    assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
  }
  assert.equal(g.result.trigger, g.result.outcome === 'success' ? 'energy' : 'gravity');
  const cards = g.events.filter(e => e.kind === 'cards').flatMap(e => (e.data as { cards: { rarity: string }[] }).cards);
  const offers = Object.fromEntries(rarityIds.map(id => [id, cards.filter(c => c.rarity === id).length]));
  rows.push({ seed, outcome: g.result.outcome, trigger: g.result.trigger, xp: g.xp, mass: g.mass, score: g.score, seconds: g.result.seconds, rushSpawns: g.rushSpawns, ...g.metrics, rarities: g.rarities, ranks: g.ranks, boosts: g.boosts, offers, selections: g.selections });
  if ((seed - start + 1) % 50 === 0) console.log(JSON.stringify({ seeds: seed - start + 1, games: rows.length, elapsedSeconds: (Date.now() - started) / 1000 }));
}
const summarize = (set: typeof rows) => ({
  games: set.length, wins: set.filter(r => r.outcome === 'success').length,
  clearRate: set.filter(r => r.outcome === 'success').length / set.length,
  earlyBefore180: set.filter(r => r.seconds < 180).length,
  afterTenMinutes: set.filter(r => r.seconds > 600).length,
  maxTargets: Math.max(...set.map(r => r.maxTargets)), maxEffects: Math.max(...set.map(r => r.maxEffects)),
  medianRushSpawns: set.map(r => r.rushSpawns).sort((a,b) => a-b)[Math.floor(set.length / 2)],
});
const summary = summarize(rows);
const legendary = rows.filter(r => r.selections.some(s => s.rarity === 'legendary'));
const withoutLegendary = rows.filter(r => !r.selections.some(s => s.rarity === 'legendary'));
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/balance.json', JSON.stringify({ sourceHash: sourceHash(), target: .2, scope: 'Automatic play under uncapped time and stat rules; prior calibration does not apply.', validationSeeds: [start,start+count-1], summary, withLegendary: summarize(legendary), withoutLegendary: summarize(withoutLegendary), rules, rows }, null, 2));
console.log(JSON.stringify({ summary, withLegendary: summarize(legendary), withoutLegendary: summarize(withoutLegendary) }));

