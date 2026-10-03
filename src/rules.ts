import values from '../design/rules.json' with { type: 'json' };

export const rules = values;
export type SkillId = keyof typeof rules.skills;
export type StatId = 'power' | 'rate' | 'accel';
export type UpgradeId = SkillId | StatId;
export type Rarity = keyof typeof rules.rarity;
export type Rarities = Record<UpgradeId, Rarity>;
export type Card = { id: UpgradeId; rarity: Rarity };
export type Ranks = Record<SkillId, number>;
export type Boosts = Record<StatId, number>;
export const skillIds = Object.keys(rules.skills) as SkillId[];
export const statIds: StatId[] = ['power', 'rate', 'accel'];
export const rarityIds: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const rarityColors: Record<Rarity, number> = { common: 0x8CE8FB, rare: 0x79AEFF, epic: 0xC899FF, legendary: 0xFFC66F };
export const blankRarities = (): Rarities => Object.fromEntries([...skillIds, ...statIds].map((id) => [id, 'common'])) as Rarities;
export const higherRarity = (a: Rarity, b: Rarity): Rarity => rarityIds.indexOf(a) >= rarityIds.indexOf(b) ? a : b;
export const rarityScale = (rarity: Rarity) => rules.rarity[rarity].scale;
export function rollRarity(roll: number): Rarity {
  let total = 0;
  for (const id of rarityIds) { total += rules.rarity[id].chance; if (roll * 100 < total) return id; }
  return 'legendary';
}
export const numberText = (value: number) => String(Number(value.toFixed(2)));
export const blankRanks = (): Ranks => Object.fromEntries(skillIds.map((id) => [id, 0])) as Ranks;
export const blankBoosts = (): Boosts => ({ power: 0, rate: 0, accel: 0 });
export const isSkill = (id: UpgradeId): id is SkillId => skillIds.includes(id as SkillId);

export function formValues(ranks: Ranks, rarities: Rarities) {
  const s = rules.skills;
  const scale = (id: SkillId) => rarityScale(rarities[id]);
  const extra = (id: SkillId) => ranks[id] ? rules.rarity[rarities[id]].extra : 0;
  return {
    area: { radius: s.area.radii[ranks.area] * scale('area') },
    repeat: { hits: s.repeat.hits[ranks.repeat] + extra('repeat') },
    multi: { count: s.multi.primaries[ranks.multi] + extra('multi') },
    chain: { hops: s.chain.hops[ranks.chain] + extra('chain') * 2, range: s.chain.ranges[ranks.chain] * scale('chain') },
    pierce: { length: s.pierce.lengths[ranks.pierce] * scale('pierce'), width: s.pierce.widths[ranks.pierce] * scale('pierce') },
    satellite: { count: s.satellite.counts[ranks.satellite] + extra('satellite'), range: s.satellite.range },
    trail: { radius: s.trail.radii[ranks.trail] * scale('trail'), lifetime: s.trail.lifetimes[ranks.trail] * scale('trail') },
    burst: { radius: s.burst.radii[ranks.burst] * scale('burst') },
  };
}
export type FormValues = ReturnType<typeof formValues>;

export const coreRadius = (mass: number) => rules.coreRadius + Math.min(rules.coreGrowthMax, rules.coreGrowth * mass);
export const orbitTarget = (mass: number, accel: number) => Math.max(0, Math.min(rules.orbitRadius, rules.orbitRadius + rules.supportPerRank * accel - rules.gravityPerMass * mass));

