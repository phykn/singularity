// The numbers on cards, skill details and the guide, from the same values combat uses.
import type { Game } from '../game/Game.ts';
import {
  blankRanks,
  critChance,
  evolutionChance,
  powerScale,
  rangeScale,
  recoveryMass,
} from '../game/rules.ts';
import type { PactId, Rarity, Rules, SkillId, UpgradeId } from '../game/rules.ts';
import { skillValues } from '../game/skills.ts';
import type { Copy } from './text/index.ts';
import type { LinkEffect } from './text/ko.ts';

export const numberText = (value: number) => String(Number(value.toFixed(2)));
const percent = (n: number) => Number(numberText(n * 100));
type Values = ReturnType<typeof skillValues>;

const attackers: SkillId[] = ['strike', 'satellite', 'surge'];
// Each effect changes the attacks of these skills in combat.ts.
const linkedAttackers: Record<LinkEffect, SkillId[]> = {
  repeat: attackers,
  multi: attackers,
  chain: [...attackers, 'return', 'charge'],
  pierce: [...attackers, 'charge'],
  return: attackers,
  burst: [...attackers, 'return', 'charge'],
  charge: ['repeat', 'multi', 'return'],
};

// Owned skills that this upgrade changes or that change it.
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

// A pact's gain and cost with its current numbers.
export function pactText(id: PactId, c: Copy, p: Rules['pacts']) {
  const values: Record<PactId, [number, number]> = {
    overheat: [percent(p.overheat.rateStep), 0],
    blast: [p.blast.damage, percent(1 - p.blast.damageScale)],
    greed: [percent(p.greed.xp), percent(p.greed.spawn)],
    quiet: [p.quiet.periodSeconds, 0],
    overclock: [0, 0],
    pulse: [0, p.pulse.missMass],
    gamble: [p.gamble.critMultiplier, percent(1 - p.gamble.normalScale)],
    horizon: [percent(p.horizon.damagePerMass), p.horizon.massSeconds],
  };
  const [gain, cost] = values[id],
    terms = c.pactTerms[id];
  return { gain: terms.gain(gain), cost: terms.cost(cost) };
}

const valuesAt = (id: UpgradeId, rank: number, rarity: Rarity, cfg: Rules) =>
  skillValues({ ...blankRanks(), [id]: rank }, { [id]: rarity }, cfg);

// What an upgrade does at a rank.
export function skillValue(
  id: UpgradeId,
  rank: number,
  rarity: Rarity,
  c: Copy,
  cfg: Rules,
  forms: Values = valuesAt(id, rank, rarity, cfg),
): string {
  const s = forms,
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
      return `${m.damage} ${n(cfg.combat.baseDamage * powerScale(rank, cfg))}`;
    case 'rate':
      return `${m.rate} +${Math.round(cfg.combat.ratePerRank * rank * 100)}%`;
    case 'range':
      return `${m.range} +${n((rangeScale(rank, cfg) - 1) * 100)}%`;
    case 'crit':
      return `${m.crit} ${n(critChance(rank, cfg) * 100)}%`;
    case 'luck':
      return `${m.evolve} ${n(evolutionChance(rank, cfg) * 100)}%`;
    case 'recover':
      return `${c.mass} -${recoveryMass(rarity, cfg)}`;
    default:
      return pactText(id, c, cfg.pacts).gain;
  }
}

// What an upgrade does in this run as it stands.
export const currentSkillValue = (game: Game, id: UpgradeId, c: Copy) =>
  skillValue(
    id,
    game.rank(id),
    game.rarities[id as SkillId] ?? 'common',
    c,
    game.rules,
    game.forms,
  );

// What taking the card changes, from the current rank to the next.
export function skillChange(
  id: UpgradeId,
  current: number,
  rarity: Rarity,
  previous: Rarity,
  c: Copy,
  cfg: Rules,
  mass = Infinity,
): string {
  const before = valuesAt(id, current, previous, cfg),
    after = valuesAt(id, current + 1, rarity, cfg),
    text = c.change,
    n = numberText;
  const count = (a: number, b: number, unit: string) => (current ? `${a}→${b}` : String(b)) + unit;
  switch (id) {
    case 'power':
      return `${n(cfg.combat.baseDamage * powerScale(current, cfg))}→${n(cfg.combat.baseDamage * powerScale(current + 1, cfg))}`;
    case 'rate':
      return text.rate;
    case 'range':
      return `${c.metric.range} +${n((rangeScale(current + 1, cfg) / rangeScale(current, cfg) - 1) * 100)}%`;
    case 'crit':
      return `${c.metric.crit} ${n(critChance(current, cfg) * 100)}→${n(critChance(current + 1, cfg) * 100)}%`;
    case 'luck':
      return `${c.metric.evolve} ${n(evolutionChance(current, cfg) * 100)}→${n(evolutionChance(current + 1, cfg) * 100)}%`;
    case 'recover':
      return `${c.mass} -${n(Math.min(mass, recoveryMass(rarity, cfg)))}`;
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
    default:
      return pactText(id, c, cfg.pacts).gain;
  }
}
