import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Game } from '../src/game/Game.ts';
import { rules, skillIds } from '../src/game/rules.ts';
import type { SkillId } from '../src/game/rules.ts';
import { assertConserved, checkCohort, median, simulationHash, sourceHash } from './engine.ts';
import { playRhythm } from './rhythm-bot.ts';

// node scripts/skill-balance.ts [count=100] [firstSeed=300000] [report] [auto,skill,...] [rulesJson]
// Every policy uses the same seeds and successful QTE inputs. Prefer the named skill
// when it matches the automatic choice's rarity; otherwise use automatic selection.
// This measures a build decision, not isolated skill damage or human clear rate.
const count = Number(process.argv[2] ?? 100);
const start = Number(process.argv[3] ?? 300000);
const output = process.argv[4] ?? 'artifacts/skill-balance.json';
const policies = process.argv[5]?.split(',') ?? ['auto', ...skillIds];
const cfg = process.argv[6] ? JSON.parse(readFileSync(process.argv[6], 'utf8')) : rules;
checkCohort(count, start);
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
const scripts = simulationHash(
  new URL(import.meta.url),
  new URL('./rhythm-bot.ts', import.meta.url),
);
console.log(
  'Perfect-QTE reference: automatic choice, or the preferred skill at its rarity. Not human clear rate.',
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
    assertConserved(game.result.counts);
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
    medianXp: median(set.map((r) => r.xp)),
  };
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceHash: hash,
      simulationHash: scripts,
      rulesOverride: process.argv[6] ?? null,
      scope:
        '60 Hz shipped GameSession at 1x; every available QTE hit successfully. Use the automatic choice; prefer the named skill when it matches that rarity. Not human clear rate.',
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
