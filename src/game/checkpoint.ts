import { Game } from './Game.ts';
import type { Phase } from './types.ts';
import { upgradeIds } from './rules.ts';
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

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validCheckpoint(value: unknown): value is Checkpoint {
  if (
    !object(value) ||
    !integer(value.seed) ||
    value.seed > 0xffffffff ||
    !finite(value.startAngle) ||
    !finite(value.pendingTicks) ||
    value.pendingTicks < -1e-8 ||
    !integer(value.ticks) ||
    !['running', 'collapse', 'ending', 'result', 'crossing'].includes(value.phase as string) ||
    typeof value.manualPaused !== 'boolean' ||
    typeof value.retired !== 'boolean' ||
    !(
      value.continuedAt === null ||
      (integer(value.continuedAt) && value.continuedAt <= value.ticks)
    ) ||
    !(value.choiceRemaining === null || finite(value.choiceRemaining)) ||
    !Array.isArray(value.inputs) ||
    !Array.isArray(value.resonances)
  )
    return false;
  const ticks = value.ticks;
  return (
    Array.from(value.inputs).every(
      (input) =>
        object(input) &&
        integer(input.tick) &&
        input.tick <= ticks &&
        typeof input.id === 'string' &&
        upgradeIds.includes(input.id as UpgradeId) &&
        integer(input.number) &&
        input.number > 0 &&
        typeof input.automatic === 'boolean' &&
        typeof input.beforeCombat === 'boolean',
    ) &&
    Array.from(value.resonances).every(
      (input) =>
        object(input) &&
        integer(input.tick) &&
        input.tick <= ticks &&
        integer(input.selectionCount) &&
        [1, 2, 3].includes(input.beat as number),
    )
  );
}

export function restoreCheckpoint(checkpoint: unknown): Game | null {
  if (!validCheckpoint(checkpoint)) return null;
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
