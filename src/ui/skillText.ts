import type { Game } from '../game/Game.ts';
import { skillValues } from '../game/skills.ts';
import type { SkillValues } from '../game/skills.ts';
import { numberText } from '../format.ts';
import {
  blankRanks,
  blankRarities,
  critChance,
  evolutionChance,
  powerScale,
  rangeScale,
  recoveryMass,
  rules,
} from '../game/rules.ts';
import type { PactId, Rarity, RuleSet, SkillId, UpgradeId } from '../game/rules.ts';
import { copy } from './i18n.ts';
import type { Language, LinkEffect } from './i18n.ts';

const attackers: SkillId[] = ['strike', 'satellite', 'surge'];
// Each effect changes the attacks of these skills in combat.ts; tests/skill-links.test.ts checks them.
const linkedAttackers: Record<LinkEffect, SkillId[]> = {
  repeat: attackers,
  multi: attackers,
  chain: [...attackers, 'return', 'charge'],
  pierce: [...attackers, 'charge'],
  return: attackers,
  burst: [...attackers, 'return', 'charge'],
  charge: ['repeat', 'multi', 'return'],
};

export function skillLinks(id: UpgradeId, owned: SkillId[]) {
  return owned.flatMap((skill) => {
    const effect = (Object.keys(linkedAttackers) as LinkEffect[]).find(
      (key) =>
        (key === id && linkedAttackers[key].includes(skill)) ||
        (key === skill && linkedAttackers[key].includes(id as SkillId)),
    );
    return effect ? [{ skill, effect }] : [];
  });
}

export function pactText(id: PactId, language: Language = 'ko', cfg: RuleSet = rules) {
  const terms = copy[language].pactTerms[id],
    p = cfg.pacts,
    percent = (n: number) => numberText(n * 100);
  const values: Record<PactId, [number, number]> = {
    overheat: [Number(percent(p.overheat.rateStep)), 0],
    blast: [p.blast.damage, Number(percent(1 - p.blast.damageScale))],
    greed: [Number(percent(p.greed.xp)), Number(percent(p.greed.spawn))],
    quiet: [p.quiet.periodSeconds, 0],
    overclock: [0, 0],
    pulse: [0, p.pulse.missMass],
    gamble: [p.gamble.critMultiplier, Number(percent(1 - p.gamble.normalScale))],
    horizon: [Number(percent(p.horizon.damagePerMass)), p.horizon.massSeconds],
  };
  const [gain, cost] = values[id];
  return { gain: terms.gain(gain), cost: terms.cost(cost) };
}

export function skillValue(
  id: UpgradeId,
  rank: number,
  rarity: Rarity = 'common',
  language: Language = 'ko',
  cfg: RuleSet = rules,
  reach = 1,
  forms?: SkillValues,
): string {
  const s =
    forms ??
    skillValues({ ...blankRanks(), [id]: rank }, { ...blankRarities(), [id]: rarity }, cfg, reach);
  const c = copy[language],
    m = c.metric,
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
      return `${m.targets(String(s.strike.count + s.multi.count - 1))} · ×${n(s.strike.damage)} · ${m.radius} ${n(s.strike.splash)}`;
    case 'satellite':
      return `${m.satellites(String(s.satellite.count))} · ×${n(s.satellite.damage)}`;
    case 'charge':
      return `${m.charge} ${n(s.charge.threshold)} · ×${n(s.charge.damage)}`;
    case 'surge':
      return `${m.charge} ${s.surge.kills} · ${n(s.surge.duration)}${c.seconds}`;
    case 'return':
      return `${m.damage} ×${n(s.return.damage)}`;
    case 'mark':
      return `${m.charge} ${s.mark.threshold} · ×${n(s.mark.damage)}`;
    case 'tempo':
      return `${m.targets(String(s.tempo.count))} · ×${n(s.tempo.damage)}`;
    case 'spark':
      return `${m.targets(String(s.spark.count))} · ×${n(s.spark.damage)}`;
    case 'field':
      return `${m.radius} ${n(s.field.radius)} · ×${n(s.field.damage)}`;
    case 'fission':
      return `${m.links(String(s.fission.depth))} · ×${n(s.fission.damage)}`;
    case 'overcharge':
      return `${m.kills} ${s.overcharge.kills} · ×${n(s.overcharge.damage)}`;
    case 'power':
      return `${m.damage} ${n(cfg.baseHitDamage * powerScale(rank, cfg))}`;
    case 'rate':
      return `${m.rate} +${Math.round(cfg.ratePerRank * rank * 100)}%`;
    case 'range':
      return `${m.range} +${n((rangeScale(rank, cfg) - 1) * 100)}%`;
    case 'crit':
      return `${m.crit} ${n(critChance(rank, cfg) * 100)}%`;
    case 'luck':
      return `${m.evolve} ${n(evolutionChance(rank, cfg) * 100)}%`;
    case 'recover':
      return `${c.mass} -${recoveryMass(rarity, cfg)}`;
    case 'overheat':
    case 'blast':
    case 'greed':
    case 'quiet':
    case 'overclock':
    case 'pulse':
    case 'gamble':
    case 'horizon':
      return pactText(id, language, cfg).gain;
  }
}

// What an upgrade does in this run as it stands.
export const currentSkillValue = (game: Game, id: UpgradeId, language: Language) =>
  skillValue(id, game.rank(id), game.rarities[id], language, game.rules, game.reach, game.forms);

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
      return `${numberText(cfg.baseHitDamage * powerScale(current, cfg))}→${numberText(cfg.baseHitDamage * powerScale(current + 1, cfg))}`;
    case 'rate':
      return text.rate;
    case 'range':
      return `${c.metric.range} +${numberText((rangeScale(current + 1, cfg) / rangeScale(current, cfg) - 1) * 100)}%`;
    case 'crit':
      return `${c.metric.crit} ${numberText(critChance(current, cfg) * 100)}→${numberText(critChance(current + 1, cfg) * 100)}%`;
    case 'luck':
      return `${c.metric.evolve} ${numberText(evolutionChance(current, cfg) * 100)}→${numberText(evolutionChance(current + 1, cfg) * 100)}%`;
    case 'recover':
      return `${c.mass} -${numberText(Math.min(mass, recoveryMass(rarity, cfg)))}`;
    case 'overheat':
    case 'blast':
    case 'greed':
    case 'quiet':
    case 'overclock':
    case 'pulse':
    case 'gamble':
    case 'horizon':
      return pactText(id, language, cfg).gain;
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
    case 'satellite':
      return c.metric.satellites(
        current
          ? `${before.satellite.count}→${after.satellite.count}`
          : String(after.satellite.count),
      );
    case 'charge':
    case 'surge':
    case 'return':
    case 'mark':
    case 'tempo':
    case 'spark':
    case 'field':
    case 'fission':
    case 'overcharge':
      return text[id][current ? 1 : 0];
  }
}
