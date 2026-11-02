import assert from 'node:assert/strict';
import { sourceHash } from './engine.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Game } from '../src/game/Game.ts';
import { rarityIds, rules, isSkill } from '../src/game/rules.ts';
import type { SkillId } from '../src/game/rules.ts';
import { guidedCard, playRhythm } from './rhythm-bot.ts';
import { createHash } from 'node:crypto';

// node scripts/balance.ts [count=900] [firstSeed=92000] [report] [qte|qte-off|qte-guided|auto|guided] [rulesJson]
// Tune on one seed cohort, then validate on an untouched cohort: qte 15–20%, qte-off 10–15%.

const count = Number(process.argv[2] ?? 900),
  start = Number(process.argv[3] ?? 92000),
  output = process.argv[4] ?? 'artifacts/balance.json',
  rows = [];
const policy = process.argv[5] ?? 'qte';
assert.ok(Number.isSafeInteger(count) && count > 0, 'Count must be a positive safe integer');
assert.ok(Number.isSafeInteger(start) && start >= 0, 'Start must be a nonnegative safe integer');
assert.ok(start + count <= 2 ** 32, 'Seed cohort must fit the uint32 seed range');
assert.ok(
  ['auto', 'guided', 'qte', 'qte-off', 'qte-guided'].includes(policy),
  'Unknown play policy',
);
const cfg = process.argv[6]
  ? (JSON.parse(readFileSync(process.argv[6], 'utf8')) as typeof rules)
  : rules;
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
    rhythm = playRhythm(g, policy === 'qte-guided' ? guidedCard : undefined, policy !== 'qte-off');
    assert.equal(rhythm.misses, 0, 'The perfect-QTE reference bot must not miss a beat');
    if (policy === 'qte-off') assert.equal(g.resonances.length, 0);
  } else if (policy === 'auto') {
    g.start();
    g.advance(1800000);
  } else {
    g.start();
    while (!g.result && g.seconds < 1800) {
      if (g.choice && g.time - g.choice.opened >= 1) {
        g.select(guidedCard(g).id);
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
      target: policy === 'qte' ? [0.15, 0.2] : policy === 'qte-off' ? [0.1, 0.15] : null,
      scope:
        policy === 'qte-off'
          ? '60 Hz real GameSession at 1x; no QTE taps. Paused choices selected immediately using the automatic choice, matching qte. Not measured human clear rate.'
          : policy.startsWith('qte')
            ? '60 Hz real GameSession at 1x; every available QTE hit at its center, including hit stop and choice interruptions. Paused choices selected immediately; qte uses the automatic choice, qte-guided uses the visible-state heuristic. Not measured human clear rate.'
            : policy === 'auto'
              ? 'Automatic selection with uncapped time and stats; human clear rates may differ.'
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
