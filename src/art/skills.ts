import { skillIds, statIds } from '../game/rules.ts';
import type { UpgradeId } from '../game/rules.ts';

export const iconIds: UpgradeId[] = [...statIds, 'recover', ...skillIds];
export const iconCells = Object.fromEntries(
  iconIds.map((id, index) => [id, { x: (index % 7) * 32, y: Math.floor(index / 7) * 32 }]),
) as Record<UpgradeId, { x: number; y: number }>;

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
