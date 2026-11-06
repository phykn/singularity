// Bot runs under plain Node: `npm run sim -- <balance|skills|beyond> [count] [firstSeed]
// [report.json] [policy] [rules.json]`. Reports carry sourceHash and simulationHash;
// compare two reports only when both match.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validate } from '../design/schema.ts';
import { Game } from '../src/game/Game.ts';
import { rules as defaultRules, skillIds } from '../src/game/rules.ts';
import type { Rules, SkillId } from '../src/game/rules.ts';

const [command = 'balance', countArg, firstArg, reportArg, policy = 'qte-off', rulesPath] =
  process.argv.slice(2);
const defaults: Record<string, number> = { balance: 100, skills: 40, beyond: 100 };
if (!(command in defaults)) throw new Error(`unknown command: ${command}`);
if (policy !== 'qte-off') throw new Error(`policy ${policy} needs the rhythm (T8)`);
const count = Number(countArg ?? defaults[command]),
  firstSeed = Number(firstArg ?? 480000),
  reportPath = reportArg ?? `artifacts/${command}.json`;
const rulesText = rulesPath ? readFileSync(rulesPath, 'utf8') : JSON.stringify(defaultRules);
const cfg = JSON.parse(rulesText) as Rules,
  problems = validate(cfg);
if (problems.length) throw new Error('rules: ' + problems.join('; '));

const digest = (files: string[], extra = '') => {
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update(readFileSync(file));
  return hash.update(extra).digest('hex').slice(0, 16);
};
const sources = ['src/game', 'src/session'].flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name)),
);

// Paused choices: the bot takes `prefer` when offered, otherwise the automatic card.
function play(seed: number, prefer?: SkillId, limitSeconds = 3600): Game {
  const game = new Game(seed, { rules: cfg });
  game.start();
  const tickRate = cfg.time.tickRate;
  while (game.phase !== 'result' && game.elapsedTicks < limitSeconds * tickRate) {
    game.run(tickRate, true);
    while (game.choice) {
      const preferred = game.choice.cards.find((c) => c.id === prefer && game.canUpgrade(c.id)),
        card = preferred ?? game.automaticCard;
      if (!card || !game.choose(card.id, game.choice.number)) break;
    }
  }
  return game;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

const started = performance.now();
let report: Record<string, unknown>, summary: string;
if (command === 'skills') {
  type Build = { runs: number; wins: number; capped: number; medianSeconds: number | null };
  const builds: Record<string, Build> = {};
  for (const id of skillIds) {
    const games = Array.from({ length: count }, (_, i) => play(firstSeed + i, id));
    builds[id] = {
      runs: count,
      wins: games.filter((g) => g.result?.outcome === 'success').length,
      // Still alive at the time cap: nothing ends a strong run before the final boss (T7).
      capped: games.filter((g) => !g.result).length,
      medianSeconds: median(games.map((g) => g.result?.collisionTime ?? g.time)),
    };
  }
  report = { builds };
  summary = skillIds.map((id) => `${id} ${builds[id].wins}/${count}`).join(', ');
  const capped = skillIds.reduce((sum, id) => sum + builds[id].capped, 0);
  if (capped) summary += ` — ${capped} run(s) alive at the cap`;
} else throw new Error(`${command} arrives with its task (balance T11, beyond T10)`);

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
      seconds: Math.round((performance.now() - started) / 100) / 10,
      ...report,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${command}: ${summary} (${((performance.now() - started) / 1000).toFixed(1)}s) → ${reportPath}`,
);
