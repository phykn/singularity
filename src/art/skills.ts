import { skillIds, statIds } from '../game/rules.ts';
import type { PactId, UpgradeId } from '../game/rules.ts';

export const iconIds: Exclude<UpgradeId, PactId>[] = [...statIds, 'recover', ...skillIds];
const cells = Object.fromEntries(
  iconIds.map((id, index) => [id, { x: (index % 7) * 32, y: Math.floor(index / 7) * 32 }]),
) as Record<Exclude<UpgradeId, PactId>, { x: number; y: number }>;
// Pacts wear the icon of the stat they strengthen.
export const iconCells: Record<UpgradeId, { x: number; y: number }> = {
  ...cells,
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
