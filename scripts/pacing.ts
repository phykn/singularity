import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Game } from '../src/game/Game.ts';
import { isPact, isSkill, rules } from '../src/game/rules.ts';
import {
  checkCohort,
  median,
  roundStarts,
  roundSummary,
  simulationHash,
  sourceHash,
} from './engine.ts';
import { guidedCard, playRhythm } from './rhythm-bot.ts';

// node scripts/pacing.ts [count=600] [firstSeed=480000] [report] [qte|qte-off|qte-guided] [rulesJson]
// Measures whether a run stays undecided after the build forms; bots, not human tension.
const count = Number(process.argv[2] ?? 600),
  start = Number(process.argv[3] ?? 480000),
  output = process.argv[4] ?? 'artifacts/pacing.json',
  policy = process.argv[5] ?? 'qte-guided';
checkCohort(count, start);
assert.ok(['qte', 'qte-off', 'qte-guided'].includes(policy), 'Unknown play policy');
const cfg = process.argv[6]
  ? (JSON.parse(readFileSync(process.argv[6], 'utf8')) as typeof rules)
  : rules;
const step = 30;
const ratio = (part: number, total: number) => (total ? part / total : null);
const rows = [];
for (let seed = start; seed < start + count; seed++) {
  const g = new Game(seed, { rules: cfg });
  const samples: { t: number; margin: number; mass: number; xp: number }[] = [];
  let next = 0,
    lateMargin = Infinity,
    targetsAt120: number | null = null;
  playRhythm(g, policy === 'qte-guided' ? guidedCard : undefined, policy !== 'qte-off', () => {
    if (targetsAt120 === null && g.phase === 'running' && g.time >= 120)
      targetsAt120 = g.targets.length;
    if (g.phase === 'running' && g.time >= 360) lateMargin = Math.min(lateMargin, g.margin);
    if (g.phase !== 'running' || g.time < next) return;
    samples.push({ t: next, margin: g.margin, mass: g.mass, xp: g.xp });
    next += step;
  });
  assert.ok(g.result);
  const ranks: Record<string, number> = {};
  let slotsFull = null,
    developed = null;
  for (const s of g.selections) {
    if (!isSkill(s.id)) continue;
    ranks[s.id] = s.rank;
    const values = Object.values(ranks);
    if (slotsFull === null && values.length >= cfg.skillSlots) slotsFull = s.time;
    if (developed === null && values.filter((r) => r >= 3).length >= cfg.skillSlots)
      developed = s.time;
  }
  const event = (kind: string) => g.events.find((e) => e.kind === kind)?.time ?? null;
  rows.push({
    seed,
    win: g.result.outcome === 'success',
    seconds: g.collisionTime,
    round: g.round,
    roundStarts: roundStarts(g),
    samples,
    targetsAt120,
    level10At:
      g.events.find((e) => e.kind === 'level' && (e.data as { level: number }).level >= 10)?.time ??
      null,
    lateMargin,
    slotsFull,
    developed,
    critical: event('critical'),
    bossAt: g.events.filter((e) => e.kind === 'boss').map((e) => e.time),
    bossKill: g.events
      .filter((e) => e.kind === 'boss')
      .map((e) => {
        const id = (e.data as { id: number }).id;
        const down = g.events.find(
          (d) => d.kind === 'boss-down' && (d.data as { id: number }).id === id,
        );
        return down ? down.time - e.time : null;
      }),
    bossDown: g.events.filter((e) => e.kind === 'boss-down').map((e) => e.time),
    bossAbsorbed: g.events.filter((e) => e.kind === 'boss-absorbed').map((e) => e.time),
    finalAt: event('final-boss'),
    finalDown: event('final-boss-down'),
    evolutions: g.selections.filter((s) => s.evolve).length,
    pacts: g.selections.filter((s) => isPact(s.id)).length,
  });
}
const wins = rows.filter((r) => r.win);
const growth = (from: number) => {
  const windows = wins.flatMap((r) => {
    const a = r.samples.find((s) => s.t === from),
      b = r.samples.find((s) => s.t === from + step);
    return a && b ? [b.mass - a.mass] : [];
  });
  return ratio(windows.filter((gain) => gain <= 0).length, windows.length);
};
const decided = (time: number, low: number) => {
  const alive = rows.flatMap((r) => {
    const sample = r.samples.find((s) => s.t === time);
    return sample && sample.margin >= low ? [r.win] : [];
  });
  return { runs: alive.length, winRate: ratio(alive.filter(Boolean).length, alive.length) };
};
const finalRuns = rows.filter((r) => r.finalAt !== null);
const stage = (index: number) => {
  const runs = rows.filter((r) => r.bossAt.length > index);
  return {
    runs: runs.length,
    medianAt: median(runs.map((r) => r.bossAt[index])),
    killed: ratio(runs.filter((r) => r.bossKill[index] !== null).length, runs.length),
    medianKillSeconds: median(runs.flatMap((r) => r.bossKill[index] ?? [])),
  };
};
const summary = {
  policy,
  games: rows.length,
  clearRate: ratio(wins.length, rows.length),
  medianWinSeconds: median(wins.map((r) => r.seconds)),
  medianSlotsFull: median(wins.flatMap((r) => (r.slotsFull === null ? [] : [r.slotsFull]))),
  medianDeveloped: median(wins.flatMap((r) => (r.developed === null ? [] : [r.developed]))),
  // Early density and growth over every run that got that far; evolution over all runs.
  targetsAt120: median(rows.flatMap((r) => (r.targetsAt120 === null ? [] : [r.targetsAt120]))),
  level10At: median(rows.flatMap((r) => (r.level10At === null ? [] : [r.level10At]))),
  evolutionRuns: ratio(rows.filter((r) => r.evolutions > 0).length, rows.length),
  noCoreGrowth: {
    '360-390': growth(360),
    '390-420': growth(390),
    '420-450': growth(420),
  },
  winAfterSafeSixMinutes: decided(360, 60),
  medianLateMargin: median(wins.map((r) => r.lateMargin)),
  closeCalls: ratio(wins.filter((r) => r.lateMargin < 30).length, wins.length),
  medianCritical: median(wins.flatMap((r) => (r.critical === null ? [] : [r.critical]))),
  rounds: roundSummary(rows.map((r) => ({ lost: !r.win, round: r.round, starts: r.roundStarts }))),
  bossStages: cfg.boss.stages.map((_, index) => stage(index)),
  bossesKilled: median(rows.map((r) => r.bossDown.length)),
  bossesAbsorbed: median(rows.map((r) => r.bossAbsorbed.length)),
  finalBoss: {
    runs: finalRuns.length,
    medianAt: median(finalRuns.map((r) => r.finalAt!)),
    killed: ratio(finalRuns.filter((r) => r.finalDown !== null).length, finalRuns.length),
    medianKillSeconds: median(
      finalRuns.flatMap((r) => (r.finalDown === null ? [] : [r.finalDown - r.finalAt!])),
    ),
  },
  evolvedWins: ratio(wins.filter((r) => r.evolutions > 0).length, wins.length),
  pactRuns: ratio(rows.filter((r) => r.pacts > 0).length, rows.length),
  pactWinRate: ratio(
    rows.filter((r) => r.pacts > 0 && r.win).length,
    rows.filter((r) => r.pacts > 0).length,
  ),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceHash: sourceHash(),
      simulationHash: simulationHash(
        new URL(import.meta.url),
        new URL('./rhythm-bot.ts', import.meta.url),
      ),
      policy,
      rulesOverride: process.argv[6] ?? null,
      seeds: [start, start + count - 1],
      summary,
      rows,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary));
