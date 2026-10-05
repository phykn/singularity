import values from '../../design/rules.json' with { type: 'json' };

export const rules = values;
export type RuleSet = typeof rules;
export type SkillId = keyof typeof rules.skills;
export type StatId = 'power' | 'rate' | 'range';
export type UpgradeId = SkillId | StatId | 'recover';
export type Rarity = keyof typeof rules.rarity;
export type Rarities = Record<UpgradeId, Rarity>;
export type Card = { id: UpgradeId; rarity: Rarity };
export type Ranks = Record<SkillId, number>;
export type Boosts = Record<StatId, number>;
export const skillIds = Object.keys(values.skills) as SkillId[];
export const statIds: StatId[] = ['power', 'rate', 'range'];
export const upgradeIds: UpgradeId[] = [...skillIds, ...statIds, 'recover'];
export const rarityIds: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const blankRarities = (): Rarities =>
  Object.fromEntries(upgradeIds.map((id) => [id, 'common'])) as Rarities;
export const higherRarity = (a: Rarity, b: Rarity): Rarity =>
  rarityIds.indexOf(a) >= rarityIds.indexOf(b) ? a : b;
export const rarityScale = (rarity: Rarity, cfg: RuleSet = rules) => cfg.rarity[rarity].scale;
export function rollRarity(roll: number, cfg: RuleSet = rules): Rarity {
  let total = 0;
  for (const id of rarityIds) {
    total += cfg.rarity[id].chance;
    if (roll * 100 < total) return id;
  }
  return 'legendary';
}
export const maxDamageNumbers = 64;
export const blankRanks = (): Ranks => Object.fromEntries(skillIds.map((id) => [id, 0])) as Ranks;
export const blankBoosts = (): Boosts => ({ power: 0, rate: 0, range: 0 });
export const isSkill = (id: UpgradeId): id is SkillId => skillIds.includes(id as SkillId);

export function rangeScale(rank: number, rarity: Rarity, cfg: RuleSet = rules): number {
  const strength = rank * rarityScale(rarity, cfg);
  return 1 + (cfg.rangeBonus * strength) / (cfg.rangeFalloff + strength);
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
