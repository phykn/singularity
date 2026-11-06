import { Game } from './Game.ts';
import { rules as defaultRules, rulesHash } from './rules.ts';
import type { Rules } from './rules.ts';
import type { Input, RunRecord } from './types.ts';

// Applies one recorded input between ticks; false if the run would not accept it now.
export function apply(game: Game, input: Input): boolean {
  if (input.kind === 'card') return game.choose(input.id, input.number);
  if (input.kind === 'beat') return game.resonate(input.beat);
  return false;
}

// Rebuilds a run from its seed and inputs under `cfg`; null when the record does not fit.
export function replay(record: RunRecord, cfg: Rules = defaultRules): Game | null {
  if (record.rules !== rulesHash(cfg)) return null;
  const game = new Game(record.seed, { rules: cfg });
  game.start();
  for (const input of record.inputs) {
    if (input.tick < game.elapsedTicks || input.tick > record.ticks) return null;
    game.run(input.tick - game.elapsedTicks);
    if (game.elapsedTicks !== input.tick || !apply(game, input)) return null;
  }
  game.run(record.ticks - game.elapsedTicks);
  return game.elapsedTicks === record.ticks ? game : null;
}
