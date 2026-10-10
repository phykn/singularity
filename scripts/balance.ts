import assert from 'node:assert/strict';
import { sourceHash } from './engine.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Game } from '../src/game/Game.ts';
import { rarityIds, rarityScale, rules, isSkill } from '../src/game/rules.ts';
import type { Card, SkillId } from '../src/game/rules.ts';
import { playRhythm } from './rhythm-bot.ts';
import { createHash } from 'node:crypto';

// node scripts/balance.ts [count=900] [firstSeed=92000] [report] [qte|qte-guided|auto|guided] [rulesJson]
// Tune on one seed cohort, then validate on an untouched cohort. Only qte is the 10–15% target.

const count = Number(process.argv[2] ?? 900),
  start = Number(process.argv[3] ?? 92000),
  output = process.argv[4] ?? 'artifacts/balance.json',
  rows = [];
const policy = process.argv[5] ?? 'qte';
assert.ok(Number.isInteger(count) && count > 0, 'Count must be a positive integer');
assert.ok(Number.isInteger(start) && start >= 0, 'Start must be a nonnegative integer');
assert.ok(['auto', 'guided', 'qte', 'qte-guided'].includes(policy), 'Unknown play policy');
const cfg = process.argv[6]
  ? (JSON.parse(readFileSync(process.argv[6], 'utf8')) as typeof rules)
  : rules;
// A reproducible, visible-state choice heuristic; this is not a human clear-rate estimate.
const strength: Record<SkillId, number> = {
  multi: 10,
  chain: 9,
  repeat: 8,
  pierce: 8,
  burst: 7,
  strike: 6,
  focus: 6,
  satellite: 6,
  bridge: 6,
  charge: 4,
  surge: 4,
  return: 4,
  repel: 4,
  chase: 4,
  vent: 3,
  gather: 3,
};
function value(g: Game, card: Card) {
  const { id, rarity } = card;
  const scale = rarityScale(rarity);
  if (id === 'recover') return g.margin < 30 ? 30 : g.mass > 65 ? 10 : 1;
  if (id === 'power') return (g.boosts.power < 3 ? 12 : 7) * scale;
  if (id === 'rate') return (g.boosts.rate < 3 ? 9 : 5) * scale;
  if (id === 'range') return (g.boosts.range < 2 ? 6 : 3) * scale;
  if (id === 'speed') return 2 * scale;
  if (isSkill(id)) return strength[id] * scale * (g.ranks[id] ? 1.15 : 1);
  return 0;
}
const started = Date.now();
const hash = sourceHash();
const simulationHash = createHash('sha256')
  .update(readFileSync(new URL('./balance.ts', import.meta.url)))
  .update(readFileSync(new URL('./rhythm-bot.ts', import.meta.url)))
  .digest('hex');
for (let seed = start; seed < start + count; seed++) {
  const g = new Game(seed, { rules: cfg });
  let rhythm = null;
  if (policy.startsWith('qte')) {
    rhythm = playRhythm(
      g,
      policy === 'qte'
        ? undefined
        : (game) => game.choice!.cards.reduce((a, b) => (value(game, b) > value(game, a) ? b : a)),
    );
    assert.equal(rhythm.misses, 0, 'The perfect-QTE reference bot must not miss a beat');
  } else if (policy === 'auto') {
    g.start();
    g.advance(1800000);
  } else {
    g.start();
    while (!g.result && g.seconds < 1800) {
      if (g.choice && g.time - g.choice.opened >= 1) {
        const card = g.choice.cards.reduce((a, b) => (value(g, b) > value(g, a) ? b : a));
        g.select(card.id);
      }
      g.advance(250);
    }
  }
  assert.ok(g.result);
  for (const c of Object.values(g.result.counts)) {
    assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
  }
  assert.equal(g.result.trigger, g.result.outcome === 'success' ? 'energy' : 'gravity');
  const cards = g.events
    .filter((e) => e.kind === 'cards')
    .flatMap((e) => (e.data as { cards: { rarity: string }[] }).cards);
  const offers = Object.fromEntries(
    rarityIds.map((id) => [id, cards.filter((c) => c.rarity === id).length]),
  );
  const lateStart = g.rules.stageStarts.at(-1)!;
  const lateSeconds = Math.max(0, g.collisionTime - lateStart);
  const lateAbsorbed = g.events.filter((e) => e.kind === 'absorb' && e.time >= lateStart).length;
  const ranks: Partial<Record<SkillId, number>> = {};
  const developed = g.selections.find((s) => {
    if (isSkill(s.id)) ranks[s.id] = s.rank;
    return Object.values(ranks).filter((rank) => rank >= 3).length === g.rules.skillSlots;
  });
  rows.push({
    seed,
    rhythm,
    outcome: g.result.outcome,
    trigger: g.result.trigger,
    xp: g.xp,
    mass: g.mass,
    score: g.score,
    seconds: g.result.seconds,
    rushSpawns: g.rushSpawns,
    ...g.metrics,
    rarities: g.rarities,
    ranks: g.ranks,
    boosts: g.boosts,
    offers,
    selections: g.selections,
    lateSeconds,
    lateAbsorbed,
    developedAt: developed?.time ?? null,
    afterDevelopedSeconds: developed ? g.collisionTime - developed.time : null,
  });
  if ((seed - start + 1) % 50 === 0)
    console.log(
      JSON.stringify({
        seeds: seed - start + 1,
        games: rows.length,
        wins: rows.filter((r) => r.outcome === 'success').length,
        elapsedSeconds: (Date.now() - started) / 1000,
      }),
    );
}
const median = (values: number[]) =>
  values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
const summarize = (set: typeof rows) => ({
  games: set.length,
  wins: set.filter((r) => r.outcome === 'success').length,
  clearRate: set.filter((r) => r.outcome === 'success').length / set.length,
  earlyBefore180: set.filter((r) => r.seconds < 180).length,
  afterTenMinutes: set.filter((r) => r.seconds > 600).length,
  maxTargets: Math.max(...set.map((r) => r.maxTargets)),
  maxEffects: Math.max(...set.map((r) => r.maxEffects)),
  medianRushSpawns: median(set.map((r) => r.rushSpawns)),
  medianWinSeconds: median(set.filter((r) => r.outcome === 'success').map((r) => r.seconds)),
  lateRuns: set.filter((r) => r.lateSeconds > 0).length,
  lateAbsorbedPerMinute:
    (set.reduce((sum, r) => sum + r.lateAbsorbed, 0) * 60) /
    (set.reduce((sum, r) => sum + r.lateSeconds, 0) || 1),
  developedRuns: set.filter((r) => r.developedAt !== null).length,
  medianAfterDevelopedSeconds: median(
    set.flatMap((r) => (r.afterDevelopedSeconds === null ? [] : [r.afterDevelopedSeconds])),
  ),
});
const summary = summarize(rows);
const z = 1.96,
  p = summary.clearRate,
  n = summary.games,
  center = (p + (z * z) / (2 * n)) / (1 + (z * z) / n),
  margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
const legendary = rows.filter((r) => r.selections.some((s) => s.rarity === 'legendary'));
const withoutLegendary = rows.filter((r) => !r.selections.some((s) => s.rarity === 'legendary'));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceHash: hash,
      simulationHash,
      policy,
      rulesOverride: process.argv[6] ?? null,
      target: policy === 'qte' ? [0.1, 0.15] : null,
      scope: policy.startsWith('qte')
        ? '60 Hz real GameSession at 1x; every available QTE hit at its center, including hit stop and choice interruptions. Paused choices selected immediately; qte uses highest rarity (first on ties), qte-guided uses the visible-state heuristic. Not measured human clear rate.'
        : policy === 'auto'
          ? 'Automatic highest-rarity selection, first card on ties, with uncapped time and stats; human clear rates may differ.'
          : 'Visible-state skill/stat/recovery heuristic selecting one second after opening; this is a bot, not measured human play.',
      validationSeeds: [start, start + count - 1],
      measurements: {
        lateStart: cfg.stageStarts.at(-1),
        developed:
          'All four skill slots at rank 3 or higher; a reproducible proxy, not a judgment of build quality.',
      },
      summary,
      confidence95: [center - margin, center + margin],
      withLegendary: summarize(legendary),
      withoutLegendary: summarize(withoutLegendary),
      rules: cfg,
      rows,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    summary,
    withLegendary: summarize(legendary),
    withoutLegendary: summarize(withoutLegendary),
  }),
);
