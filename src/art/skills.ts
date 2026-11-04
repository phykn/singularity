import { skillIds, statIds } from '../game/rules.ts';
import type { PactId, UpgradeId } from '../game/rules.ts';

// Static Mark and Tempo Coil borrow existing icons until their own art is made (docs/IMAGE_GENERATION.md).
const borrowed = { mark: 'charge', tempo: 'repeat' } as const;
export const iconIds = [
  ...statIds,
  'recover',
  ...skillIds.filter((id) => !(id in borrowed)),
] as Exclude<UpgradeId, PactId | keyof typeof borrowed>[];
const cells = Object.fromEntries(
  iconIds.map((id, index) => [id, { x: (index % 7) * 32, y: Math.floor(index / 7) * 32 }]),
) as Record<(typeof iconIds)[number], { x: number; y: number }>;
// Pacts wear the icon of the stat they strengthen.
export const iconCells: Record<UpgradeId, { x: number; y: number }> = {
  ...cells,
  mark: cells[borrowed.mark],
  tempo: cells[borrowed.tempo],
  overload: cells.power,
  greed: cells.speed,
  overclock: cells.rate,
};

export const controlIds = [
  'github',
  'star',
  'help',
  'settings',
  'pause',
  'play',
  'next',
  'charge',
] as const;
export type ControlId = (typeof controlIds)[number];
export const controlCells = Object.fromEntries(
  controlIds.map((id, index) => [id, { x: (index % 4) * 32, y: Math.floor(index / 4) * 32 }]),
) as Record<ControlId, { x: number; y: number }>;
