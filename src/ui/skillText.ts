import { numberText } from '../format.ts';
import { blankRanks, blankRarities, formValues, rarityScale, rules } from '../game/rules.ts';
import type { Rarity, RuleSet, UpgradeId } from '../game/rules.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function skillValue(
  id: UpgradeId,
  rank: number,
  rarity: Rarity = 'common',
  language: Language = 'ko',
  cfg: RuleSet = rules,
): string {
  const s = formValues({ ...blankRanks(), [id]: rank }, { ...blankRarities(), [id]: rarity }, cfg);
  const c = copy[language],
    m = c.metric,
    scale = rarityScale(rarity, cfg),
    n = numberText;
  switch (id) {
    case 'area':
      return `${m.radius} ${n(s.area.radius)}`;
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
      return `${m.targets(String(s.strike.count))} · ×${n(cfg.skills.strike.damage)}`;
    case 'wave':
      return `${m.radius} ${n(s.wave.radius)} · ${m.push} ${n(s.wave.push)}`;
    case 'whip':
      return `${m.length} ${n(s.whip.length)} · ${Math.round((s.whip.arc * 180) / Math.PI)}°`;
    case 'focus':
      return `${n(s.focus.duration)}${c.seconds} · ${m.slow} ${Math.round((1 - s.focus.slow) * 100)}%`;
    case 'power':
      return `${m.damage} ${n(cfg.baseHitDamage + cfg.damagePerRank * rank * scale)}`;
    case 'rate':
      return `${m.rate} +${Math.round(cfg.ratePerRank * rank * scale * 100)}%`;
    case 'accel':
      return `${m.speed} ${Math.round(cfg.baseSpeed * (1 + cfg.speedPerRank * rank * scale))}`;
  }
}

export function skillChange(
  id: UpgradeId,
  current: number,
  rarity: Rarity = 'common',
  previous: Rarity = 'common',
  language: Language = 'ko',
  cfg: RuleSet = rules,
): string {
  const before = formValues(
    { ...blankRanks(), [id]: current },
    { ...blankRarities(), [id]: previous },
    cfg,
  );
  const after = formValues(
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
    case 'accel':
      return text.accel;
    case 'area':
      return text.area[current ? 1 : 0];
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
    case 'wave':
      return text.wave[current ? 1 : 0];
    case 'whip':
      return text.whip[current ? 1 : 0];
    case 'focus':
      return text.focus[current ? 1 : 0];
  }
}
