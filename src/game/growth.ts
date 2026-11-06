import type { Random } from './random.ts';
import { isSkill, skillIds, statIds } from './rules.ts';
import type { Boosts, Ranks, Rules, SkillId, UpgradeId } from './rules.ts';

// Skills that hit more than one particle; the first offer leads with one of them.
const broad: readonly SkillId[] = ['chain', 'multi', 'pierce', 'satellite', 'strike'];

export function eligibleUpgrades(ranks: Ranks, cfg: Rules, recoverable: boolean, slots: number) {
  const owned = skillIds.filter((id) => ranks[id] > 0).length;
  const skills = skillIds.filter(
    (id) => ranks[id] < cfg.growth.maxRank && (ranks[id] > 0 || owned < slots),
  );
  return [...skills, ...statIds, ...(recoverable ? ['recover' as const] : [])] as UpgradeId[];
}

export type Offer = {
  ranks: Ranks;
  boosts: Boosts;
  number: number;
  danger: boolean;
  recoverable: boolean;
  slots: number;
};

// The first offer is skills only; later ones alternate skill-led and stat-led,
// and mass release leads whenever the orbit is in danger.
export function offerCards(offer: Offer, random: Random, cfg: Rules): UpgradeId[] {
  const { ranks, boosts, number, danger, recoverable, slots } = offer,
    count = cfg.growth.choiceCount;
  const pool = random.shuffle(eligibleUpgrades(ranks, cfg, recoverable, slots)),
    skills = pool.filter(isSkill);
  if (number === 1) {
    const cards = skills.slice(0, count),
      lead = cards.find((id) => broad.includes(id)) ?? skills.find((id) => broad.includes(id))!;
    if (!cards.includes(lead)) cards[count - 1] = lead;
    return [lead, ...cards.filter((id) => id !== lead)];
  }
  const owned = skillIds.filter((id) => ranks[id] > 0),
    existing = skills.filter((id) => ranks[id] > 0).sort((a, b) => ranks[a] - ranks[b]),
    fresh = skills.find((id) => ranks[id] === 0);
  const skill = owned.length < 2 ? (fresh ?? existing[0]) : (existing[0] ?? fresh);
  const stat = statIds.filter((id) => pool.includes(id)).sort((a, b) => boosts[a] - boosts[b])[0];
  const lead = danger && recoverable ? 'recover' : number % 2 ? (skill ?? stat) : (stat ?? skill);
  const cards: UpgradeId[] = [lead];
  const add = (id: UpgradeId | undefined) => {
    if (id && !cards.includes(id) && cards.length < count) cards.push(id);
  };
  add(isSkill(lead) ? pool.find((id) => !isSkill(id)) : (existing[0] ?? fresh));
  if (!cards.some((id) => isSkill(id) && ranks[id] > 0)) add(existing[0]);
  pool.forEach(add);
  return cards;
}
