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

export function formValues(ranks: Ranks, rarities: Rarities, cfg: RuleSet = rules, reach = 1) {
  const s = cfg.skills;
  const scale = (id: SkillId) => rarityScale(rarities[id], cfg);
  const extra = (id: SkillId) => (ranks[id] ? cfg.rarity[rarities[id]].extra : 0);
  const multi = s.multi.primaries[ranks.multi] + extra('multi');
  return {
    repeat: {
      hits: s.repeat.hits[ranks.repeat] + extra('repeat'),
      damage: s.repeat.damage * (ranks.repeat ? scale('repeat') : 1),
    },
    multi: { count: multi, damage: 1 / (1 + s.multi.spreadCost * (multi - 1)) },
    chain: {
      hops: s.chain.hops[ranks.chain] + extra('chain'),
      range: s.chain.ranges[ranks.chain] * scale('chain') * reach,
    },
    pierce: {
      length: s.pierce.lengths[ranks.pierce] * scale('pierce') * reach,
      width: s.pierce.widths[ranks.pierce],
    },
    burst: {
      radius: s.burst.radii[ranks.burst] * scale('burst'),
      count: s.burst.targets[ranks.burst] + extra('burst'),
      damage: s.burst.damage[ranks.burst] * scale('burst'),
    },
    strike: {
      count: s.strike.counts[ranks.strike] + extra('strike'),
      range: s.strike.range * reach,
      damage: s.strike.damage[ranks.strike] * scale('strike'),
    },
    repel: {
      count: s.repel.counts[ranks.repel] + extra('repel'),
      range: s.repel.range * reach,
      push: s.repel.push[ranks.repel] * scale('repel'),
    },
    focus: {
      range: s.focus.ranges[ranks.focus] * scale('focus') * reach,
      duration: s.focus.durations[ranks.focus],
      damage: s.focus.damage * scale('focus'),
    },
    orb: {
      radius: s.orb.radii[ranks.orb] * scale('orb') * reach,
      duration: s.orb.duration[ranks.orb],
      damage: s.orb.damage * scale('orb'),
    },
    charge: {
      threshold: s.charge.threshold[ranks.charge],
      damage: s.charge.damage[ranks.charge] * scale('charge'),
    },
    bridge: {
      length: s.bridge.lengths[ranks.bridge] * scale('bridge') * reach,
      duration: s.bridge.duration[ranks.bridge],
      count: s.bridge.count[ranks.bridge] + extra('bridge'),
      damage: s.bridge.damage[ranks.bridge] * scale('bridge'),
    },
    gather: {
      radius: s.gather.radii[ranks.gather] * scale('gather') * reach,
      count: s.gather.count[ranks.gather] + extra('gather'),
      pull: s.gather.pull[ranks.gather] * scale('gather'),
    },
    stun: { duration: s.stun.duration[ranks.stun] * scale('stun') },
    chase: {
      threshold: s.chase.threshold[ranks.chase],
      count: s.chase.count[ranks.chase] + extra('chase'),
      damage: s.chase.damage[ranks.chase] * scale('chase'),
    },
    surge: {
      kills: Math.max(3, s.surge.kills[ranks.surge] - extra('surge')),
      duration: s.surge.duration[ranks.surge],
      damage: s.surge.damage * scale('surge'),
    },
    return: { damage: s.return.damage[ranks.return] * scale('return') },
  };
}
export type FormValues = ReturnType<typeof formValues>;

export const coreRadius = (mass: number, cfg: RuleSet = rules) =>
  cfg.coreRadius + Math.min(cfg.coreGrowthMax, cfg.coreGrowth * mass);
export const orbitTarget = (mass: number, cfg: RuleSet = rules) =>
  Math.max(0, Math.min(cfg.orbitRadius, cfg.orbitRadius - cfg.gravityPerMass * mass));
