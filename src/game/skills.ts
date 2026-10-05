import { rarityScale, rules } from './rules.ts';
import type { Ranks, Rarities, RuleSet, SkillId } from './rules.ts';

export const timedSkills = ['strike', 'repel', 'focus', 'orb', 'gather', 'chase'] as const;
export type TimedSkill = (typeof timedSkills)[number];

export function skillValues(ranks: Ranks, rarities: Rarities, cfg: RuleSet = rules, reach = 1) {
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
      threshold: s.charge.threshold[ranks.charge] / scale('charge'),
      damage: s.charge.damage[ranks.charge] * scale('charge'),
    },
    bridge: {
      length: s.bridge.lengths[ranks.bridge] * scale('bridge') * reach,
      duration: s.bridge.duration[ranks.bridge],
      count: s.bridge.count[ranks.bridge] + extra('bridge'),
      damage: s.bridge.damage[ranks.bridge] * scale('bridge'),
      width: s.bridge.width[ranks.bridge] * scale('bridge'),
    },
    gather: {
      radius: s.gather.radii[ranks.gather] * scale('gather') * reach,
      count: s.gather.count[ranks.gather] + extra('gather'),
      pull: s.gather.pull[ranks.gather] * scale('gather'),
      damage: s.gather.damage[ranks.gather] * scale('gather'),
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
    return: {
      damage: s.return.damage[ranks.return] * scale('return'),
      width: s.return.width[ranks.return] * scale('return'),
    },
  };
}
export type SkillValues = ReturnType<typeof skillValues>;
