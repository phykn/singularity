import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Game } from '../src/game/Game.ts';
import { rules, skillIds } from '../src/game/rules.ts';
import type { SkillId } from '../src/game/rules.ts';
import { sourceHash } from './engine.ts';
import { playRhythm } from './rhythm-bot.ts';

// node scripts/skill-balance.ts [count=100] [firstSeed=300000] [report] [auto,skill,...] [rulesJson]
// Every policy uses the same seeds and successful QTE inputs. Prefer the named skill
// among cards tied for highest rarity; otherwise use automatic selection.
// This measures a build decision, not isolated skill damage or human clear rate.
const count = Number(process.argv[2] ?? 100);
const start = Number(process.argv[3] ?? 300000);
const output = process.argv[4] ?? 'artifacts/skill-balance.json';
const policies = process.argv[5]?.split(',') ?? ['auto', ...skillIds];
const cfg = process.argv[6] ? JSON.parse(readFileSync(process.argv[6], 'utf8')) : rules;
assert.ok(Number.isSafeInteger(count) && count > 0);
assert.ok(Number.isSafeInteger(start) && start >= 0 && start + count <= 2 ** 32);
assert.ok(new Set(policies).size === policies.length);
assert.ok(policies.every((id) => id === 'auto' || skillIds.includes(id as SkillId)));

const rows: {
  policy: string;
  seed: number;
  win: boolean;
  xp: number;
  seconds: number;
  ranks: Game['ranks'];
  rarities: Game['rarities'];
  picks: Game['selections'];
}[] = [];
const started = Date.now();
const hash = sourceHash();
const simulationHash = createHash('sha256')
  .update(readFileSync(new URL(import.meta.url)))
  .update(readFileSync(new URL('./rhythm-bot.ts', import.meta.url)))
  .digest('hex');
console.log(
  'Perfect-QTE reference: highest rarity, preferred skill on ties. Not human clear rate.',
);
for (const policy of policies) {
  for (let seed = start; seed < start + count; seed++) {
    const game = new Game(seed, { rules: cfg });
    const played = playRhythm(game, (g) => {
      const best = g.automaticCard!;
      return g.choice!.cards.find((c) => c.id === policy && c.rarity === best.rarity) ?? best;
    });
    assert.equal(played.misses, 0);
    assert.ok(game.result, 'A simulated run must reach an ending');
    for (const c of Object.values(game.result.counts))
      assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
    rows.push({
      policy,
      seed,
      win: game.result.outcome === 'success',
      xp: game.xp,
      seconds: game.result.seconds,
      ranks: game.ranks,
      rarities: game.rarities,
      picks: game.selections,
    });
    if ((seed - start + 1) % 20 === 0)
      console.log(
        JSON.stringify({
          policy,
          runs: seed - start + 1,
          wins: rows.filter((r) => r.policy === policy && r.win).length,
          elapsed: (Date.now() - started) / 1000,
        }),
      );
  }
}
const baseline = rows.filter((r) => r.policy === 'auto');
const wins = (set: typeof rows) => set.filter((r) => r.win).length;
const summary = policies.map((policy) => {
  const set = rows.filter((r) => r.policy === policy);
  const acquired = set.filter((r) => r.ranks[policy as SkillId] > 0);
  const gained = baseline.filter((b) => !b.win && set.find((r) => r.seed === b.seed)!.win).length;
  const lost = baseline.filter((b) => b.win && !set.find((r) => r.seed === b.seed)!.win).length;
  return {
    policy,
    games: set.length,
    wins: wins(set),
    clearRate: wins(set) / set.length,
    acquired: acquired.length,
    acquiredWins: wins(acquired),
    gained: baseline.length ? gained : null,
    lost: baseline.length ? lost : null,
    medianXp: set.map((r) => r.xp).sort((a, b) => a - b)[Math.floor(set.length / 2)],
  };
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceHash: hash,
      simulationHash,
      rulesOverride: process.argv[6] ?? null,
      scope:
        '60 Hz shipped GameSession at 1x; every available QTE hit successfully. Choose highest rarity; prefer the named skill only on rarity ties, otherwise first on ties. Actual four-slot and first-pick rarity rules. Same seed does not imply identical later offers after builds diverge. Rates include seeds where the preferred skill was never offered. Not measured human play or a causal estimate of owning a skill.',
      seeds: [start, start + count - 1],
      rules: cfg,
      summary,
      rows,
    },
    null,
    2,
  ),
);
console.table(summary);
console.log('Report: ' + output);
