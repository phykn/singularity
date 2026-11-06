// Bot runs under plain Node: `npm run sim -- <balance|skills|beyond> [count] [firstSeed]
// [report.json] [policy] [rules.json]`. Runs are split across worker threads. Reports carry
// sourceHash and simulationHash; compare two reports only when both match.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { validate } from '../design/schema.ts';
import { Game } from '../src/game/Game.ts';
import { Session } from '../src/session/Session.ts';
import { rules as defaultRules, skillIds } from '../src/game/rules.ts';
import type { Rules, SkillId } from '../src/game/rules.ts';

// PRD Success criteria 2 and R23. Clear-rate ranges per policy.
const clearRange: Record<string, [number, number]> = { qte: [0.15, 0.2], 'qte-off': [0.1, 0.15] };
type Event = Game['events'][number];
type Job = { seed: number; prefer?: SkillId };
type Run = {
  seed: number;
  prefer?: SkillId;
  win: boolean;
  ended: boolean;
  seconds: number;
  round: number;
  targetsAt120: number | null;
  level10At: number | null;
  evolved: boolean;
  firsts: [string, number][];
};

// "New things": the first sight of each giant, event, formation, species and wave.
const novel = (e: Event): string[] =>
  ['boss', 'final-boss', 'critical', 'wave'].includes(e.kind)
    ? [`${e.kind}:${e.data.boss ?? e.data.number ?? ''}`]
    : e.kind === 'formation'
      ? [`shape:${e.data.shape}`]
      : e.kind === 'spawn'
        ? (e.data.placed as { particle: string }[]).map((p) => `particle:${p.particle}`)
        : [];

// Paused choices: the bot takes `prefer` when offered, otherwise the automatic card.
// `qte` drives the real session at 60 Hz and taps every beat at the gate's center;
// `qte-off` runs the model directly, which is the same game without taps.
function play(cfg: Rules, policy: string, { seed, prefer }: Job, limitSeconds = 3600): Run {
  const game = new Game(seed, { rules: cfg, recordEvents: false }),
    tickRate = cfg.time.tickRate,
    firsts = new Map<string, number>([['start', 0]]);
  let cursor = 0,
    targetsAt120: number | null = null,
    level10At: number | null = null;
  const card = () =>
    game.choice!.cards.find((c) => c.id === prefer && game.canUpgrade(c.id)) ?? game.automaticCard;
  // The browser-sized log keeps a quarter second, so read it more often than that.
  const observe = () => {
    for (const e of game.events.slice(Math.max(0, cursor - game.eventOffset)))
      for (const key of novel(e)) if (!firsts.has(key)) firsts.set(key, e.time);
    cursor = game.eventCount;
    if (targetsAt120 === null && game.phase === 'running' && game.time >= 120)
      targetsAt120 = game.targets.length;
    if (level10At === null && game.level >= 10) level10At = game.time;
  };
  const going = () => game.phase !== 'result' && game.elapsedTicks < limitSeconds * tickRate;
  if (policy === 'qte') {
    const audio = {
      enabled: false,
      unlock: async () => true,
      suspend() {},
      update() {},
      play() {},
      destroy() {},
    };
    const session = new Session(game, audio, {
      sound: () => false,
      audioFailed() {},
      record() {},
      redraw() {},
    });
    session.setReady(true, 0);
    session.start(0);
    for (let frame = 1; going(); frame++) {
      const wall = (frame * 1000) / 60,
        r = session.rhythm;
      session.frame(wall);
      if (frame % 10 === 0) observe();
      if (game.choice) {
        const pick = card();
        if (pick) session.select(pick.id, game.choice.number, wall);
      } else if (session.rhythmAvailable && r.open && r.due <= r.age) session.tap(wall);
    }
  } else {
    game.start();
    while (going()) {
      game.run(10, true);
      observe();
      for (let pick = game.choice && card(); pick; pick = game.choice && card())
        if (!game.choose(pick.id, game.choice!.number)) break;
    }
  }
  observe();
  return {
    seed,
    prefer,
    win: game.result?.outcome === 'success',
    ended: !!game.result,
    seconds: game.result?.collisionTime ?? game.time,
    round: game.round,
    targetsAt120,
    level10At,
    evolved: Object.keys(game.evolved).length > 0,
    firsts: [...firsts],
  };
}

if (!isMainThread) {
  const { rulesText, policy, jobs } = workerData as {
    rulesText: string;
    policy: string;
    jobs: Job[];
  };
  const cfg = JSON.parse(rulesText) as Rules;
  parentPort!.postMessage(jobs.map((job) => play(cfg, policy, job)));
} else await main();

async function main() {
  const [command = 'balance', countArg, firstArg, reportArg, policy = 'qte-off', rulesPath] =
    process.argv.slice(2);
  const defaults: Record<string, number> = { balance: 100, skills: 40, beyond: 100 };
  if (!(command in defaults)) throw new Error(`unknown command: ${command}`);
  if (!(policy in clearRange)) throw new Error(`unknown policy: ${policy}`);
  if (command === 'beyond') throw new Error('beyond arrives with endless mode (T10)');
  const count = Number(countArg ?? defaults[command]),
    firstSeed = Number(firstArg ?? 480000),
    reportPath = reportArg ?? `artifacts/${command}.json`;
  const rulesText = rulesPath ? readFileSync(rulesPath, 'utf8') : JSON.stringify(defaultRules);
  const problems = validate(JSON.parse(rulesText));
  if (problems.length) throw new Error('rules: ' + problems.join('; '));
  const started = performance.now();

  const seeds = Array.from({ length: count }, (_, i) => firstSeed + i);
  const jobs: Job[] =
    command === 'skills'
      ? skillIds.flatMap((prefer) => seeds.map((seed) => ({ seed, prefer })))
      : seeds.map((seed) => ({ seed }));
  // Interleaved chunks so slow late seeds spread over the workers.
  const workers = Math.max(1, Math.min(availableParallelism() - 1, jobs.length));
  const runs = (
    await Promise.all(
      Array.from({ length: workers }, (_, w) => {
        const chunk = jobs.filter((_, i) => i % workers === w);
        return new Promise<Run[]>((resolve, reject) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: { rulesText, policy, jobs: chunk },
          });
          worker.once('message', resolve).once('error', reject);
        });
      }),
    )
  ).flat();

  let report: Record<string, unknown>, summary: string;
  if (command === 'skills') {
    const builds = Object.fromEntries(
      skillIds.map((id) => {
        const mine = runs.filter((r) => r.prefer === id);
        return [
          id,
          {
            runs: mine.length,
            wins: mine.filter((r) => r.win).length,
            capped: mine.filter((r) => !r.ended).length,
            medianSeconds: median(mine.map((r) => r.seconds)),
          },
        ];
      }),
    );
    report = { builds };
    summary = skillIds.map((id) => `${id} ${builds[id].wins}/${count}`).join(', ');
  } else {
    const wins = runs.filter((r) => r.win),
      losses = runs.filter((r) => !r.win);
    const minutes = new Map<number, number>(),
      lossesByRound: Record<number, number> = {};
    for (const r of losses) {
      const minute = Math.floor(r.seconds / 60);
      minutes.set(minute, (minutes.get(minute) ?? 0) + 1);
      lossesByRound[r.round] = (lossesByRound[r.round] ?? 0) + 1;
    }
    const firsts = runs.map((r) => new Map(r.firsts)),
      keys = [...new Set(firsts.flatMap((f) => [...f.keys()]))].sort();
    // The longest wait between new things, up to the end of the run.
    const gaps = runs.map((r, i) => {
      const times = [...firsts[i].values()].sort((a, b) => a - b);
      return Math.max(...times.map((t, j) => (times[j + 1] ?? r.seconds) - t));
    });
    const [low, high] = clearRange[policy];
    const checks = {
      clearRate: check(wins.length / count, low, high),
      medianWinSeconds: check(median(wins.map((r) => r.seconds)), 900, 1200),
      earliestLossSeconds: check(
        losses.length ? Math.min(...losses.map((r) => r.seconds)) : null,
        180,
      ),
      // Share of losses that fall in the worst one-minute window.
      worstMinuteLossShare: check(
        losses.length ? Math.max(...minutes.values()) / losses.length : 0,
        0,
        0.15,
      ),
      targetsAt120: check(median(runs.map((r) => r.targetsAt120)), 20),
      level10Seconds: check(median(runs.map((r) => r.level10At)), 0, 210),
    };
    report = {
      checks,
      lossesByRound,
      worstLossMinute: [...minutes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      evolutionRunShare: runs.filter((r) => r.evolved).length / count,
      // Information only: when each new thing first shows, and the longest quiet stretch.
      firstSeen: Object.fromEntries(
        keys.map((k) => [k, round(median(firsts.map((f) => f.get(k) ?? null)))]),
      ),
      longestQuietSeconds: round(median(gaps)),
    };
    summary = Object.entries(checks)
      .map(([k, c]) => `${k} ${round(c.value, 2)} ${c.pass ? 'ok' : 'FAIL'}`)
      .join(', ');
  }

  const sources = ['src/game', 'src/session'].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(dir, name)),
  );
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        command,
        count,
        firstSeed,
        policy,
        rules: rulesPath ?? 'design/rules.json',
        sourceHash: digest(sources, rulesText),
        simulationHash: digest(['scripts/sim.ts']),
        seconds,
        ...report,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${command}: ${summary} (${seconds}s) → ${reportPath}`);
}

function digest(files: string[], extra = '') {
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update(readFileSync(file));
  return hash.update(extra).digest('hex').slice(0, 16);
}
function median(values: (number | null)[]) {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}
function round(n: number | null, digits = 1) {
  return n === null ? null : Number(n.toFixed(digits));
}
// A value with its target range and whether it passes.
function check(value: number | null, min: number, max = Infinity) {
  return {
    value,
    range: [min, max === Infinity ? null : max],
    pass: value !== null && value >= min && value <= max,
  };
}
