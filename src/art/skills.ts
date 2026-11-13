import { pactIds, skillIds, statIds } from '../game/rules.ts';
import type { SkillId, UpgradeId } from '../game/rules.ts';

// `skills.png` holds every card icon in eight columns, then one evolved icon per skill.
export const iconIds: UpgradeId[] = [...statIds, 'recover', ...skillIds, ...pactIds];
const cell = (index: number) => ({ x: (index % 8) * 32, y: Math.floor(index / 8) * 32 });
export const iconCells = Object.fromEntries(
  iconIds.map((id, index) => [id, cell(index)]),
) as Record<UpgradeId, { x: number; y: number }>;
export const evolvedCells = Object.fromEntries(
  skillIds.map((id, index) => [id, cell(iconIds.length + index)]),
) as Record<SkillId, { x: number; y: number }>;
export const iconAtlasSize = { width: 256, height: 192 };

const controlIds = [
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
export const controlAtlasSize = { width: 128, height: 64 };
export const controlCells = Object.fromEntries(
  controlIds.map((id, index) => [id, { x: (index % 4) * 32, y: Math.floor(index / 4) * 32 }]),
) as Record<ControlId, { x: number; y: number }>;
