import values from '../../design/rules.json' with { type: 'json' };

export const rules = values;
export type RuleSet = typeof rules;
export type SkillId = keyof typeof rules.skills;
export type StatId = 'power' | 'rate' | 'range' | 'crit' | 'luck';
export const pactIds = [
  'overheat',
  'blast',
  'greed',
  'quiet',
  'overclock',
  'pulse',
  'gamble',
  'horizon',
] as const;
export type PactId = (typeof pactIds)[number];
export type UpgradeId = SkillId | StatId | 'recover' | PactId;
export type Rarity = keyof typeof rules.rarity;
export type Rarities = Record<UpgradeId, Rarity>;
export type Card = { id: UpgradeId; rarity: Rarity; evolve?: boolean };
export type Ranks = Record<SkillId, number>;
export type Boosts = Record<StatId, number>;
export const skillIds = Object.keys(values.skills) as SkillId[];
export const statIds: StatId[] = ['power', 'rate', 'range', 'crit', 'luck'];
export const upgradeIds: UpgradeId[] = [...skillIds, ...statIds, 'recover', ...pactIds];
export const rarityIds: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const blankRarities = (): Rarities =>
  Object.fromEntries(upgradeIds.map((id) => [id, 'common'])) as Rarities;
export const rarityScale = (rarity: Rarity, cfg: RuleSet = rules) => cfg.rarity[rarity].scale;
// Luck moves chance from common to the higher rarities in proportion to their own chances.
export function rarityChances(luck = 0, cfg: RuleSet = rules): Record<Rarity, number> {
  const common = cfg.rarity.common.chance,
    shift = Math.min(common, cfg.luck.rarityShift * luck),
    rest = 100 - common;
  return Object.fromEntries(
    rarityIds.map((id) => [
      id,
      id === 'common' ? common - shift : cfg.rarity[id].chance * (1 + shift / rest),
    ]),
  ) as Record<Rarity, number>;
}
export function rollRarity(roll: number, cfg: RuleSet = rules, luck = 0): Rarity {
  const chances = rarityChances(luck, cfg);
  let total = 0;
  for (const id of rarityIds) {
    total += chances[id];
    if (roll * 100 < total) return id;
  }
  return 'legendary';
}
export const powerScale = (rank: number, cfg: RuleSet = rules) =>
  1 + (cfg.powerBonus * rank) / (cfg.powerFalloff + rank);
export const critChance = (rank: number, cfg: RuleSet = rules) =>
  Math.min(cfg.crit.max, cfg.crit.perRank * rank);
export const evolutionChance = (luck: number, cfg: RuleSet = rules) =>
  Math.min(cfg.evolution.maxChance, cfg.evolution.chance + cfg.evolution.luckChance * luck);
export const maxDamageNumbers = 64;
export const damageNumberSeconds = 0.72;
export const blankRanks = (): Ranks => Object.fromEntries(skillIds.map((id) => [id, 0])) as Ranks;
export const blankBoosts = (): Boosts => ({ power: 0, rate: 0, range: 0, crit: 0, luck: 0 });
export const isSkill = (id: UpgradeId): id is SkillId => skillIds.includes(id as SkillId);
export const isStat = (id: UpgradeId): id is StatId => statIds.includes(id as StatId);
export const isPact = (id: UpgradeId): id is PactId => pactIds.includes(id as PactId);

export function rangeScale(rank: number, cfg: RuleSet = rules): number {
  return 1 + (cfg.rangeBonus * rank) / (cfg.rangeFalloff + rank);
}

export const recoveryMass = (rarity: Rarity, cfg: RuleSet = rules) =>
  Math.round(cfg.recovery.mass * rarityScale(rarity, cfg));

export function xpForLevel(level: number, cfg: RuleSet = rules): number {
  if (level <= 1) return 0;
  const thresholds = cfg.levelXp,
    extra = level - 1 - thresholds.length;
  if (extra <= 0) return thresholds[level - 2];
  const last = thresholds.at(-1)!,
    step = last - thresholds.at(-2)!;
  return last + extra * step + (cfg.levelXpStep * extra * (extra + 1)) / 2;
}

export function levelForXp(xp: number, cfg: RuleSet = rules): number {
  const thresholds = cfg.levelXp,
    last = thresholds.at(-1)!;
  if (xp <= last) return 1 + thresholds.filter((value) => value <= xp).length;
  const step = last - thresholds.at(-2)! + cfg.levelXpStep / 2;
  const extra = Math.floor(
    (2 * (xp - last)) / (Math.sqrt(step * step + 2 * cfg.levelXpStep * (xp - last)) + step),
  );
  return 1 + thresholds.length + extra;
}

export const coreRadius = (mass: number, cfg: RuleSet = rules) =>
  cfg.coreRadius + Math.min(cfg.coreGrowthMax, cfg.coreGrowth * mass);
export const orbitTarget = (mass: number, cfg: RuleSet = rules) =>
  Math.max(0, Math.min(cfg.orbitRadius, cfg.orbitRadius - cfg.gravityPerMass * mass));
