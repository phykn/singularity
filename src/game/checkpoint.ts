import { Game } from './Game.ts';
import type { Phase } from './types.ts';
import type { UpgradeId } from './rules.ts';

export type Checkpoint = {
  seed: number;
  startAngle: number;
  pendingTicks: number;
  ticks: number;
  phase: Exclude<Phase, 'ready'>;
  manualPaused: boolean;
  continuedAt: number | null;
  retired: boolean;
  choiceRemaining: number | null;
  resonances: { tick: number; selectionCount: number; beat: 1 | 2 | 3 }[];
  inputs: {
    tick: number;
    id: UpgradeId;
    number: number;
    automatic: boolean;
    beforeCombat: boolean;
  }[];
};

export function createCheckpoint(game: Game): Checkpoint | null {
  if (game.phase === 'ready' || !game.combatEnabled) return null;
  return {
    seed: game.seed,
    startAngle: game.startAngle,
    pendingTicks: game.pendingTicks,
    ticks: game.elapsedTicks,
    phase: game.phase,
    manualPaused: game.manualPaused,
    continuedAt: game.continuedAt,
    retired: game.result?.outcome === 'retired',
    choiceRemaining: game.choice ? game.choice.deadline - game.time : null,
    resonances: game.resonances.map((input) => ({ ...input })),
    inputs: game.selections.map((selection, i) => ({
      tick: selection.tick,
      id: selection.id,
      number: i + 1,
      automatic: selection.automatic,
      beforeCombat: selection.beforeCombat,
    })),
  };
}

export function restoreCheckpoint(checkpoint: Checkpoint): Game | null {
  if (
    !Array.isArray(checkpoint.resonances) ||
    !Number.isFinite(checkpoint.startAngle) ||
    !Number.isFinite(checkpoint.pendingTicks) ||
    checkpoint.pendingTicks < -1e-8
  )
    return null;
  const game = new Game(checkpoint.seed);
  game.angle = checkpoint.startAngle;
  game.start();
  const inputs = [
    ...checkpoint.inputs.map((input) => ({
      ...input,
      kind: 'choice' as const,
      order: input.number * 2,
    })),
    ...checkpoint.resonances.map((input) => ({
      ...input,
      kind: 'resonance' as const,
      order: input.selectionCount * 2 + 1,
    })),
    ...(checkpoint.continuedAt === null
      ? []
      : [{ tick: checkpoint.continuedAt, kind: 'beyond' as const, order: Infinity }]),
  ].sort((a, b) => a.tick - b.tick || a.order - b.order);
  for (const input of inputs) {
    const beforeCombat = input.kind === 'choice' && input.beforeCombat;
    const precedingTick = input.tick - (beforeCombat ? 1 : 0);
    if (precedingTick < game.elapsedTicks || input.tick > checkpoint.ticks) return null;
    game.advance(((precedingTick - game.elapsedTicks) * 1000) / game.rules.tickRate, Infinity, {
      autoSelect: false,
    });
    if (game.elapsedTicks !== precedingTick) return null;
    const applyInput = () => {
      if (input.kind === 'beyond') return game.continueBeyond();
      if (input.kind === 'resonance')
        return input.selectionCount === game.selections.length && game.resonate(input.beat);
      if (game.choice) game.choice.deadline = Infinity;
      return game.select(input.id, input.automatic, input.number, input.beforeCombat);
    };
    // Automatic choices can precede attacks in a tick; manual choices happen after it.
    if (beforeCombat) {
      let applied = false;
      game.advance(1000 / game.rules.tickRate, 1, {
        autoSelect: false,
        beforeCombat: () => {
          applied = applyInput();
        },
      });
      if (!applied) return null;
    } else if (!applyInput()) return null;
  }
  game.advance(((checkpoint.ticks - game.elapsedTicks) * 1000) / game.rules.tickRate, Infinity, {
    autoSelect: false,
  });
  if (checkpoint.retired && !game.retire()) return null;
  if (game.choice && checkpoint.choiceRemaining !== null)
    game.choice.deadline = game.time + checkpoint.choiceRemaining;
  else if (!!game.choice !== (checkpoint.choiceRemaining !== null)) return null;
  if (game.elapsedTicks !== checkpoint.ticks || game.phase !== checkpoint.phase) return null;
  game.pendingTicks = checkpoint.pendingTicks;
  game.manualPaused = checkpoint.manualPaused;
  return game;
}
