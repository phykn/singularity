import { skillValues } from '../game/skills.ts';
import { numberText } from '../format.ts';
import {
  blankRanks,
  blankRarities,
  rarityScale,
  rangeScale,
  recoveryMass,
  rules,
} from '../game/rules.ts';
import type { Rarity, RuleSet, UpgradeId } from '../game/rules.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function skillValue(
  id: UpgradeId,
  rank: number,
  rarity: Rarity = 'common',
  language: Language = 'ko',
  cfg: RuleSet = rules,
  reach = 1,
): string {
  const s = skillValues(
    { ...blankRanks(), [id]: rank },
    { ...blankRarities(), [id]: rarity },
    cfg,
    reach,
  );
  const c = copy[language],
    m = c.metric,
    scale = rarityScale(rarity, cfg),
    n = numberText;
  switch (id) {
    case 'repeat':
      return m.hits(String(s.repeat.hits));
    case 'multi':
      return m.targets(String(s.multi.count));
    case 'chain':
      return `${m.links(String(s.chain.hops))} · ${m.range} ${n(s.chain.range)}`;
    case 'pierce':
      return `${m.length} ${n(s.pierce.length)} · ${m.width} ${n(s.pierce.width)}`;
    case 'burst':
      return `${m.radius} ${n(s.burst.radius)} · ×${n(s.burst.damage)}`;
    case 'strike':
      return `${m.targets(String(s.strike.count))} · ×${n(s.strike.damage)}`;
    case 'repel':
      return `${m.targets(String(s.repel.count))} · ${m.push} ${n(s.repel.push)}`;
    case 'focus':
      return `${n(s.focus.duration)}${c.seconds} · ×${n(s.focus.damage)}`;
    case 'orb':
      return `${n(s.orb.duration)}${c.seconds} · ${m.radius} ${n(s.orb.radius)}`;
    case 'charge':
      return `${m.charge} ${n(s.charge.threshold)} · ×${n(s.charge.damage)}`;
    case 'bridge':
      return `${m.length} ${n(s.bridge.length)} · ${n(s.bridge.duration)}${c.seconds}`;
    case 'gather':
      return `${m.targets(String(s.gather.count))} · ${m.radius} ${n(s.gather.radius)}`;
    case 'stun':
      return `${m.stun} ${n(s.stun.duration)}${c.seconds}`;
    case 'chase':
      return `${m.health} <=${Math.round(s.chase.threshold * 100)}% · ×${n(s.chase.damage)}`;
    case 'surge':
      return `${m.kills} ${s.surge.kills} · ${n(s.surge.duration)}${c.seconds}`;
    case 'return':
      return `${m.damage} ×${n(s.return.damage)}`;
    case 'power':
      return `${m.damage} ${n(cfg.baseHitDamage + cfg.damagePerRank * rank * scale)}`;
    case 'rate':
      return `${m.rate} +${Math.round(cfg.ratePerRank * rank * scale * 100)}%`;
    case 'range':
      return `${m.range} +${n((rangeScale(rank, rarity, cfg) - 1) * 100)}%`;
    case 'recover':
      return `${c.mass} -${recoveryMass(rarity, cfg)}`;
  }
}

export function skillChange(
  id: UpgradeId,
  current: number,
  rarity: Rarity = 'common',
  previous: Rarity = 'common',
  language: Language = 'ko',
  cfg: RuleSet = rules,
  mass = Infinity,
): string {
  const before = skillValues(
    { ...blankRanks(), [id]: current },
    { ...blankRarities(), [id]: previous },
    cfg,
  );
  const after = skillValues(
    { ...blankRanks(), [id]: current + 1 },
    { ...blankRarities(), [id]: rarity },
    cfg,
  );
  const c = copy[language],
    text = c.change;
  const count = (a: number, b: number, unit: string) => (current ? `${a}→${b}` : String(b)) + unit;
  switch (id) {
    case 'power':
      return `${numberText(cfg.baseHitDamage + current * cfg.damagePerRank * rarityScale(previous, cfg))}→${numberText(cfg.baseHitDamage + (current + 1) * cfg.damagePerRank * rarityScale(rarity, cfg))}`;
    case 'rate':
      return text.rate;
    case 'range':
      return `${c.metric.range} +${numberText((rangeScale(current + 1, rarity, cfg) / rangeScale(current, previous, cfg) - 1) * 100)}%`;
    case 'recover':
      return `${c.mass} -${numberText(Math.min(mass, recoveryMass(rarity, cfg)))}`;
    case 'repeat':
      return count(before.repeat.hits, after.repeat.hits, text.repeat);
    case 'multi':
      return count(before.multi.count, after.multi.count, text.multi);
    case 'chain':
      return c.metric.links(String(after.chain.hops));
    case 'pierce':
      return text.pierce[current ? 1 : 0];
    case 'burst':
      return text.burst[current ? 1 : 0];
    case 'strike':
      return c.metric.targets(
        current ? `${before.strike.count}→${after.strike.count}` : String(after.strike.count),
      );
    case 'repel':
    case 'focus':
    case 'orb':
    case 'charge':
    case 'bridge':
    case 'gather':
    case 'stun':
    case 'chase':
    case 'surge':
    case 'return':
      return text[id][current ? 1 : 0];
  }
}
