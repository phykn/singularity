import { isSkill, rules, skillIds, statIds } from './rules.ts';
import type { Boosts, Ranks, RuleSet, SkillId, UpgradeId } from './rules.ts';
import type { Random } from './random.ts';

export function eligibleSkills(ranks: Ranks, cfg: RuleSet = rules): SkillId[] {
  const owned = skillIds.filter((id) => ranks[id] > 0).length;
  return skillIds.filter(
    (id) => ranks[id] < cfg.maxRank && (ranks[id] > 0 || owned < cfg.skillSlots),
  );
}

export function eligibleUpgrades(
  ranks: Ranks,
  cfg: RuleSet = rules,
  recoverable = false,
): UpgradeId[] {
  return [...eligibleSkills(ranks, cfg), ...statIds, ...(recoverable ? ['recover' as const] : [])];
}

type CardState = {
  ranks: Ranks;
  boosts: Boosts;
  number: number;
  danger: boolean;
  recoverable: boolean;
};
export function makeCards(state: CardState, random: Random, cfg: RuleSet = rules): UpgradeId[] {
  const { ranks, boosts, number, danger, recoverable } = state;
  const pool = random.shuffle(eligibleUpgrades(ranks, cfg, recoverable));
  if (pool.length < cfg.choiceCount) throw new Error('Not enough valid growth cards');
  if (number === 1) {
    const forms = pool.filter(isSkill),
      cards = forms.slice(0, cfg.choiceCount);
    const broad = (id: SkillId) => ['chain', 'multi', 'pierce', 'satellite'].includes(id);
    const lead = cards.find(broad) ?? forms.find(broad)!;
    if (!cards.includes(lead)) cards[2] = lead;
    return [lead, ...cards.filter((id) => id !== lead)];
  }
  const forms = pool.filter(isSkill),
    owned = skillIds.filter((id) => ranks[id] > 0);
  const existing = forms.filter((id) => ranks[id] > 0).sort((a, b) => ranks[a] - ranks[b]);
  const fresh = forms.find((id) => ranks[id] === 0);
  const form = owned.length < 2 ? (fresh ?? existing[0]) : (existing[0] ?? fresh);
  const stat = statIds.filter((id) => pool.includes(id)).sort((a, b) => boosts[a] - boosts[b])[0];
  const lead = danger && recoverable ? 'recover' : number % 2 ? (form ?? stat) : (stat ?? form);
  const cards: UpgradeId[] = [lead];
  const add = (id: UpgradeId | undefined) => {
    if (id && !cards.includes(id) && cards.length < cfg.choiceCount) cards.push(id);
  };
  add(isSkill(lead) ? pool.find((id) => !isSkill(id)) : (existing[0] ?? fresh));
  if (!cards.some((id) => isSkill(id) && ranks[id] > 0)) add(existing[0]);
  pool.forEach(add);
  return cards;
}
