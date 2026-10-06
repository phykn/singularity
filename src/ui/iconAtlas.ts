import { skillIds, statIds } from '../game/rules.ts';
import type { UpgradeId } from '../game/rules.ts';

export const iconIds: UpgradeId[] = [...statIds, 'recover', ...skillIds];
export const iconCells = Object.fromEntries(
  iconIds.map((id, index) => [id, { x: (index % 7) * 32, y: Math.floor(index / 7) * 32 }]),
) as Record<UpgradeId, { x: number; y: number }>;
