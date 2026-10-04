import values from '../design/rules.json' with { type: 'json' };

export const rules = values;
export type RuleSet = typeof rules;
export type SkillId = keyof typeof rules.skills;
export type StatId = 'power' | 'rate' | 'accel';
export type UpgradeId = SkillId | StatId;
export type Rarity = keyof typeof rules.rarity;
export type Rarities = Record<UpgradeId, Rarity>;
export type Card = { id: UpgradeId; rarity: Rarity };
export type Ranks = Record<SkillId, number>;
export type Boosts = Record<StatId, number>;
export const skillIds = Object.keys(values.skills) as SkillId[];
export const statIds: StatId[] = ['power', 'rate', 'accel'];
export const rarityIds: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const rarityColors: Record<Rarity, number> = { common: 0x8CE8FB, rare: 0x79AEFF, epic: 0xC899FF, legendary: 0xFFC66F };
export const blankRarities = (): Rarities => Object.fromEntries([...skillIds, ...statIds].map((id) => [id, 'common'])) as Rarities;
export const higherRarity = (a: Rarity, b: Rarity): Rarity => rarityIds.indexOf(a) >= rarityIds.indexOf(b) ? a : b;
export const rarityScale = (rarity: Rarity, cfg: RuleSet = rules) => cfg.rarity[rarity].scale;
export function rollRarity(roll: number, cfg: RuleSet = rules): Rarity {
  let total = 0;
  for (const id of rarityIds) { total += cfg.rarity[id].chance; if (roll * 100 < total) return id; }
  return 'legendary';
}
export const numberText = (value: number) => String(Number(value.toFixed(2)));
export const blankRanks = (): Ranks => Object.fromEntries(skillIds.map((id) => [id, 0])) as Ranks;
export const blankBoosts = (): Boosts => ({ power: 0, rate: 0, accel: 0 });
export const isSkill = (id: UpgradeId): id is SkillId => skillIds.includes(id as SkillId);

export function xpForLevel(level: number, cfg: RuleSet = rules): number {
  if (level <= 1) return 0;
  const thresholds = cfg.levelXp, extra = level - 1 - thresholds.length;
  if (extra <= 0) return thresholds[level - 2];
  const last = thresholds.at(-1)!, step = last - thresholds.at(-2)!;
  return last + extra * step + cfg.levelXpStep * extra * (extra + 1) / 2;
}

export function levelForXp(xp: number, cfg: RuleSet = rules): number {
  const thresholds = cfg.levelXp, last = thresholds.at(-1)!;
  if (xp <= last) return 1 + thresholds.filter(value => value <= xp).length;
  const step = last - thresholds.at(-2)! + cfg.levelXpStep / 2;
  const extra = Math.floor(2 * (xp - last) / (Math.sqrt(step * step + 2 * cfg.levelXpStep * (xp - last)) + step));
  return 1 + thresholds.length + extra;
}

export function formValues(ranks: Ranks, rarities: Rarities, cfg: RuleSet = rules) {
  const s = cfg.skills;
  const scale = (id: SkillId) => rarityScale(rarities[id], cfg);
  const extra = (id: SkillId) => ranks[id] ? cfg.rarity[rarities[id]].extra : 0;
  return {
    area: { radius: s.area.radii[ranks.area] * scale('area') },
    repeat: { hits: s.repeat.hits[ranks.repeat] + extra('repeat') },
    multi: { count: s.multi.primaries[ranks.multi] + extra('multi') },
    chain: { hops: s.chain.hops[ranks.chain] + extra('chain') * 2, range: s.chain.ranges[ranks.chain] * scale('chain') },
    pierce: { length: s.pierce.lengths[ranks.pierce] * scale('pierce'), width: s.pierce.widths[ranks.pierce] * scale('pierce') },
    burst: { radius: s.burst.radii[ranks.burst] * scale('burst'), count: s.burst.targets[ranks.burst] + extra('burst') },
    strike: { count: s.strike.counts[ranks.strike] + extra('strike'), radius: s.strike.radii[ranks.strike] * scale('strike') },
    wave: { radius: s.wave.radii[ranks.wave] * scale('wave') },
    whip: { length: s.whip.lengths[ranks.whip] * scale('whip'), arc: s.whip.arcs[ranks.whip] * Math.PI / 180 },
    focus: { range: s.focus.ranges[ranks.focus] * scale('focus'), duration: s.focus.durations[ranks.focus], damage: s.focus.damage * scale('focus') },
  };
}
export type FormValues = ReturnType<typeof formValues>;

export const coreRadius = (mass: number, cfg: RuleSet = rules) => cfg.coreRadius + Math.min(cfg.coreGrowthMax, cfg.coreGrowth * mass);
export const orbitTarget = (mass: number, accel: number, cfg: RuleSet = rules) => Math.max(0, Math.min(cfg.orbitRadius, cfg.orbitRadius + cfg.supportPerRank * accel - cfg.gravityPerMass * mass));

