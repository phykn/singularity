import { Game } from './model.ts';
import type { Phase } from './types.ts';
import type { UpgradeId } from './rules.ts';

export type Checkpoint = {
  seed: number;
  ticks: number;
  phase: Exclude<Phase, 'ready'>;
  manualPaused: boolean;
  inputs: { tick: number; id: UpgradeId; number: number }[];
};

export function createCheckpoint(game: Game): Checkpoint | null {
  if (game.phase === 'ready' || !game.combatEnabled) return null;
  return {
    seed: game.seed,
    ticks: game.elapsedTicks,
    phase: game.phase,
    manualPaused: game.manualPaused,
    inputs: game.selections.flatMap((selection, i) =>
      selection.automatic
        ? []
        : [
            {
              tick: Math.round(selection.time * game.rules.tickRate),
              id: selection.id,
              number: i + 1,
            },
          ],
    ),
  };
}

export function restoreCheckpoint(checkpoint: Checkpoint): Game | null {
  const game = new Game(checkpoint.seed);
  game.start();
  for (const input of checkpoint.inputs) {
    if (input.tick < game.tick || input.tick > checkpoint.ticks) return null;
    game.advance(((input.tick - game.tick) * 1000) / game.rules.tickRate);
    if (!game.select(input.id, false, input.number)) return null;
  }
  game.advance(((checkpoint.ticks - game.elapsedTicks) * 1000) / game.rules.tickRate);
  if (game.elapsedTicks !== checkpoint.ticks || game.phase !== checkpoint.phase) return null;
  game.manualPaused = checkpoint.manualPaused;
  return game;
}
