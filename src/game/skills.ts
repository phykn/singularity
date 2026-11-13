import type { Rarity, Rules, SkillId, StatId } from './rules.ts';

export type Ranks = Record<SkillId, number>;
export type Boosts = Record<StatId, number>;
export type Rarities = Partial<Record<SkillId, Rarity>>;

// Skills on their own timer.
export const timedSkills = ['strike', 'satellite', 'spark', 'field'] as const;
export type TimedSkill = (typeof timedSkills)[number];
// Skills that fire alongside the basic attack and share its cooldown.
export const linkedSkills: readonly SkillId[] = ['multi', 'repeat', 'chain', 'pierce', 'return'];

// Bonuses that flatten as ranks grow: 1 + bonus * rank / (falloff + rank).
const flatten = (bonus: number, falloff: number, rank: number) =>
  1 + (bonus * rank) / (falloff + rank);
export const powerScale = (rank: number, cfg: Rules) =>
  flatten(cfg.combat.powerBonus, cfg.combat.powerFalloff, rank);
export const rangeScale = (rank: number, cfg: Rules) =>
  flatten(cfg.combat.rangeBonus, cfg.combat.rangeFalloff, rank);
export const critChance = (rank: number, cfg: Rules) =>
  Math.min(cfg.combat.crit.max, cfg.combat.crit.perRank * rank);

// Each skill's current values from its rank, the rarity it was first taken at and the
// range bonus (`reach`).
export function skillValues(ranks: Ranks, rarities: Rarities, cfg: Rules, reach = 1) {
  const s = cfg.skills,
    tiers = cfg.growth.rarity;
  const scale = (id: SkillId) => tiers[rarities[id] ?? 'common'].scale;
  const extra = (id: SkillId) => (ranks[id] ? tiers[rarities[id] ?? 'common'].extra : 0);
  const multi = s.multi.primaries[ranks.multi] + extra('multi');
  return {
    repeat: {
      hits: s.repeat.hits[ranks.repeat] + extra('repeat'),
      damage: s.repeat.damage * (ranks.repeat ? scale('repeat') : 1),
    },
    multi: { count: multi, damage: scale('multi') / (1 + s.multi.spreadCost * (multi - 1)) },
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
      splash: s.strike.splash.radius[ranks.strike] * scale('strike'),
    },
    satellite: {
      count: s.satellite.counts[ranks.satellite],
      range: s.satellite.ranges[ranks.satellite] * reach,
      damage: s.satellite.damage * scale('satellite'),
    },
    charge: {
      threshold: s.charge.threshold[ranks.charge] / scale('charge'),
      damage: s.charge.damage[ranks.charge] * scale('charge'),
    },
    surge: {
      kills: Math.max(3, s.surge.kills[ranks.surge] - extra('surge')),
      duration: s.surge.duration[ranks.surge],
      damage: s.surge.damage * scale('surge'),
    },
    return: {
      damage: s.return.damage[ranks.return] * scale('return'),
      width: s.return.width[ranks.return] * scale('return'),
    },
    mark: {
      threshold: Math.max(3, s.mark.threshold[ranks.mark] - extra('mark')),
      damage: s.mark.damage[ranks.mark] * scale('mark'),
    },
    tempo: {
      count: s.tempo.count[ranks.tempo] + extra('tempo'),
      band: s.tempo.band[ranks.tempo] * reach,
      damage: s.tempo.damage[ranks.tempo] * scale('tempo'),
    },
    spark: {
      count: s.spark.count[ranks.spark] + extra('spark'),
      range: s.spark.range * reach,
      damage: s.spark.damage[ranks.spark] * scale('spark'),
    },
    field: {
      radius: s.field.radius[ranks.field] * scale('field') * reach,
      damage: s.field.damage[ranks.field] * scale('field'),
      bossFraction: s.field.bossFraction[ranks.field] * scale('field'),
    },
    fission: {
      depth: s.fission.depth[ranks.fission] + extra('fission'),
      radius: s.fission.radius[ranks.fission] * scale('fission'),
      damage: s.fission.damage[ranks.fission] * scale('fission'),
    },
    overcharge: {
      kills: Math.max(10, s.overcharge.kills[ranks.overcharge] - 4 * extra('overcharge')),
      band: s.overcharge.band[ranks.overcharge] * reach,
      damage: s.overcharge.damage[ranks.overcharge] * scale('overcharge'),
    },
  };
}
export type SkillValues = ReturnType<typeof skillValues>;
