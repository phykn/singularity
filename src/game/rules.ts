import values from '../../design/rules.json' with { type: 'json' };
import type { Rules } from '../../design/schema.ts';
import { hash } from './random.ts';

export type { Rules };
// JSON imports widen literal types; `npm run check:design` checks the file against the schema.
export const rules = values as unknown as Rules;
export const rulesHash = (cfg: Rules) => hash(JSON.stringify(cfg)).toString(16).padStart(8, '0');

export type SkillId = keyof Rules['skills'];
export type PactId = keyof Rules['pacts'];
export type StatId = 'power' | 'rate' | 'range' | 'crit' | 'luck';
export type UpgradeId = SkillId | StatId | 'recover' | PactId;
export type Rarity = keyof Rules['growth']['rarity'];
export type PopStyle = Rules['skills'][SkillId]['pop'];
export type Card = { id: UpgradeId; rarity: Rarity; evolve?: boolean };
export type Ranks = Record<SkillId, number>;
export type Boosts = Record<StatId, number>;

export const skillIds = Object.keys(rules.skills) as SkillId[];
export const statIds: StatId[] = ['power', 'rate', 'range', 'crit', 'luck'];
export const pactIds = Object.keys(rules.pacts) as PactId[];
export const upgradeIds: UpgradeId[] = [...skillIds, ...statIds, 'recover', ...pactIds];
export const rarityIds: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const isSkill = (id: UpgradeId): id is SkillId => id in rules.skills;
export const isPact = (id: UpgradeId): id is PactId => id in rules.pacts;
export const isStat = (id: UpgradeId): id is StatId => statIds.includes(id as StatId);
export const blankRanks = () => Object.fromEntries(skillIds.map((id) => [id, 0])) as Ranks;
export const blankBoosts = (): Boosts => ({ power: 0, rate: 0, range: 0, crit: 0, luck: 0 });

// Bonuses that flatten as ranks grow: 1 + bonus * rank / (falloff + rank).
const flatten = (bonus: number, falloff: number, rank: number) =>
  1 + (bonus * rank) / (falloff + rank);
export const powerScale = (rank: number, cfg: Rules) =>
  flatten(cfg.combat.powerBonus, cfg.combat.powerFalloff, rank);
export const rangeScale = (rank: number, cfg: Rules) =>
  flatten(cfg.combat.rangeBonus, cfg.combat.rangeFalloff, rank);
export const critChance = (rank: number, cfg: Rules) =>
  Math.min(cfg.combat.crit.max, cfg.combat.crit.perRank * rank);
export const evolutionChance = (luck: number, cfg: Rules) => {
  const e = cfg.growth.evolution;
  return Math.min(e.maxChance, e.chance + e.luckChance * luck);
};
export const recoveryMass = (rarity: Rarity, cfg: Rules) =>
  Math.round(cfg.growth.recovery.mass * cfg.growth.rarity[rarity].scale);

// Luck moves chance from common to the higher rarities in proportion to their own chances.
export function rollRarity(roll: number, luck: number, cfg: Rules): Rarity {
  const r = cfg.growth.rarity,
    shift = Math.min(r.common.chance, cfg.growth.luck.rarityShift * luck);
  let total = 0;
  for (const id of rarityIds) {
    total +=
      id === 'common'
        ? r.common.chance - shift
        : r[id].chance * (1 + shift / (100 - r.common.chance));
    if (roll * 100 < total) return id;
  }
  return 'legendary';
}

// Past the table, each level costs the last step plus `levelXpStep` more than the one before.
export function xpForLevel(level: number, cfg: Rules): number {
  const table = cfg.growth.levelXp,
    extra = level - 1 - table.length;
  if (level <= 1) return 0;
  if (extra <= 0) return table[level - 2];
  const last = table.at(-1)!;
  return last + extra * (last - table.at(-2)!) + (cfg.growth.levelXpStep * extra * (extra + 1)) / 2;
}
export function levelForXp(xp: number, cfg: Rules): number {
  const table = cfg.growth.levelXp,
    last = table.at(-1)!;
  if (xp <= last) return 1 + table.filter((value) => value <= xp).length;
  const step = last - table.at(-2)! + cfg.growth.levelXpStep / 2;
  const extra = Math.floor(
    (2 * (xp - last)) / (Math.sqrt(step * step + 2 * cfg.growth.levelXpStep * (xp - last)) + step),
  );
  return 1 + table.length + extra;
}

export const coreRadius = (mass: number, cfg: Rules) =>
  cfg.orbit.coreRadius + Math.min(cfg.orbit.coreGrowthMax, cfg.orbit.coreGrowth * mass);
export const orbitTarget = (mass: number, cfg: Rules) =>
  Math.max(0, Math.min(cfg.orbit.radius, cfg.orbit.radius - cfg.orbit.gravityPerMass * mass));
