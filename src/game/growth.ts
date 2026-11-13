import type { Game } from './Game.ts';
import { CENTER } from './geometry.ts';
import type { Random } from './random.ts';
import { isPact, isSkill, isStat, pactIds, rarityIds, skillIds, statIds } from './rules.ts';
import type { PactId, Rarity, Rules, SkillId, UpgradeId } from './rules.ts';
import { rangeScale, skillValues } from './skills.ts';
import type { Boosts, Ranks, Rarities, SkillValues } from './skills.ts';
import type { Card, Choice, Selection } from './types.ts';

// Skills that hit more than one particle; the first offer leads with one of them.
const broad: readonly SkillId[] = ['chain', 'multi', 'pierce', 'satellite', 'strike'];

// Past the table, each level costs the last step plus `levelXpStep` more than the one before.
function xpForLevel(level: number, cfg: Rules): number {
  const table = cfg.growth.levelXp,
    extra = level - 1 - table.length;
  if (level <= 1) return 0;
  if (extra <= 0) return table[level - 2];
  const last = table.at(-1)!;
  return last + extra * (last - table.at(-2)!) + (cfg.growth.levelXpStep * extra * (extra + 1)) / 2;
}
function levelForXp(xp: number, cfg: Rules): number {
  const table = cfg.growth.levelXp,
    last = table.at(-1)!;
  if (xp <= last) return 1 + table.filter((value) => value <= xp).length;
  const step = last - table.at(-2)! + cfg.growth.levelXpStep / 2;
  const extra = Math.floor(
    (2 * (xp - last)) / (Math.sqrt(step * step + 2 * cfg.growth.levelXpStep * (xp - last)) + step),
  );
  return 1 + table.length + extra;
}

export const evolutionChance = (luck: number, cfg: Rules) => {
  const e = cfg.growth.evolution;
  return Math.min(e.maxChance, e.chance + e.luckChance * luck);
};
export const recoveryMass = (rarity: Rarity, cfg: Rules) =>
  Math.round(cfg.growth.recovery.mass * cfg.growth.rarity[rarity].scale);

// Luck moves chance from common to the higher rarities in proportion to their own chances.
function rollRarity(roll: number, luck: number, cfg: Rules): Rarity {
  const r = cfg.growth.rarity,
    shift = Math.min(r.common.chance, cfg.growth.luck.rarityShift * luck);
  let total = 0;
  for (const id of rarityIds) {
    total +=
      id === 'common'
        ? r.common.chance - shift
        : r[id].chance * (1 + shift / (100 - r.common.chance));
    if (roll * 100 < total) return id;
  }
  return 'legendary';
}

// What the run has gained: XP and level, skill ranks, stats, evolutions and pacts,
// and the cards on offer at each level.
export class Growth {
  xp = 0;
  ranks = Object.fromEntries(skillIds.map((id) => [id, 0])) as Ranks;
  boosts: Boosts = { power: 0, rate: 0, range: 0, crit: 0, luck: 0 };
  // The rarity a skill was first taken at; it keeps it for the run.
  rarities: Rarities = {};
  evolved: Partial<Record<SkillId, boolean>> = {};
  pacts: Partial<Record<PactId, boolean>> = {};
  values!: SkillValues;
  choice: Choice | null = null;
  selections: Selection[] = [];
  remainder = 0;
  private readonly game: Game;
  private readonly cards: Random;
  private readonly rarity: Random;

  constructor(game: Game, cards: Random, rarity: Random) {
    this.game = game;
    this.cards = cards;
    this.rarity = rarity;
    this.refresh();
  }

  get level(): number {
    return levelForXp(this.xp, this.game.rules);
  }
  get levelProgress(): { current: number; required: number } {
    const cfg = this.game.rules,
      previous = xpForLevel(this.level, cfg);
    return { current: this.xp - previous, required: xpForLevel(this.level + 1, cfg) - previous };
  }
  // Slots grow as giant particles fall (`growth.slotKills`).
  get skillSlots(): number {
    const g = this.game.rules.growth;
    return g.skillSlots + g.slotKills.filter((kills) => this.game.giants.down >= kills).length;
  }
  get ownedSkills(): SkillId[] {
    return skillIds.filter((id) => this.ranks[id] > 0);
  }
  get pactCount(): number {
    return pactIds.filter((id) => this.pacts[id]).length;
  }
  // Overclock gives up mass release.
  get recoverable(): boolean {
    return this.game.mass >= this.game.rules.growth.recovery.minMass && !this.pacts.overclock;
  }

  rank(id: UpgradeId): number {
    if (isPact(id)) return this.pacts[id] ? 1 : 0;
    return isSkill(id) ? this.ranks[id] : isStat(id) ? this.boosts[id] : 0;
  }

  // Skill values follow ranks, rarities and range; call after changing any of them.
  refresh(): void {
    const cfg = this.game.rules;
    this.values = skillValues(this.ranks, this.rarities, cfg, rangeScale(this.boosts.range, cfg));
  }

  // Greed and the critical breach scale XP; fractions carry over to the next gain.
  gain(amount: number): void {
    const cfg = this.game.rules,
      scale =
        (this.game.critical ? cfg.critical.xpScale : 1) *
        (this.pacts.greed ? 1 + cfg.pacts.greed.xp : 1),
      gained = amount * scale + this.remainder,
      whole = Math.floor(gained + 1e-8);
    this.remainder = Math.max(0, gained - whole);
    this.xp += whole;
  }

  // Evolution and pact cards are judged as offered; the rest by rank, slots and mass.
  canUpgrade(id: UpgradeId): boolean {
    const card = this.choice?.cards.find((entry) => entry.id === id);
    if (card?.evolve) return !this.evolved[id as SkillId];
    if (isPact(id))
      return !!card && !this.pacts[id] && this.pactCount < this.game.rules.growth.pacts.max;
    return this.eligible().includes(id);
  }

  // Mass release in danger, then an evolution, a pact only while the orbit is safe,
  // then early attack upgrades, then the highest rarity.
  get automaticCard(): Card | undefined {
    const g = this.game,
      safe = g.margin > g.rules.orbit.autoPactMargin,
      cards =
        this.choice?.cards.filter(
          (card) => this.canUpgrade(card.id) && (safe || !isPact(card.id)),
        ) ?? [];
    return (
      cards.find((card) => card.id === 'recover' && g.danger) ??
      cards.find((card) => card.evolve) ??
      cards.find((card) => isPact(card.id)) ??
      cards.find(
        ({ id }) =>
          (id === 'power' || id === 'rate') && this.boosts[id] < g.rules.growth.autoStatRank,
      ) ??
      cards.reduce<Card | undefined>(
        (a, b) => (!a || rarityIds.indexOf(b.rarity) > rarityIds.indexOf(a.rarity) ? b : a),
        undefined,
      )
    );
  }

  // Puts cards on offer while a level is unspent.
  open(): void {
    const g = this.game;
    if (g.phase !== 'running' || this.choice || this.selections.length >= this.level - 1) return;
    const number = this.selections.length + 1;
    // Stats are always common; a skill keeps the rarity it was first taken at.
    const offered = this.offer(number).map((id): Card => {
      const rolled = rollRarity(this.rarity.next(), this.boosts.luck, g.rules);
      return {
        id,
        rarity: isStat(id) ? 'common' : ((isSkill(id) ? this.rarities[id] : undefined) ?? rolled),
      };
    });
    const evolution = this.evolutionOffer(),
      evolutions: Card[] = evolution
        ? [{ id: evolution, rarity: this.rarities[evolution] ?? 'common', evolve: true }]
        : [];
    const pact = !evolution && !g.danger ? this.pactOffer(number) : undefined;
    if (pact) offered[offered.length - 1] = { id: pact, rarity: 'common' };
    // In danger the recovery card stays first; an evolution takes the next place.
    const lead = offered[0]?.id === 'recover' ? offered.slice(0, 1) : [],
      cards = [...lead, ...evolutions, ...offered.slice(lead.length)].slice(
        0,
        g.rules.growth.choiceCount,
      );
    this.choice = { cards, number };
    g.log('cards', { number, cards });
  }

  private eligible(): UpgradeId[] {
    const max = this.game.rules.growth.maxRank,
      open = this.ownedSkills.length < this.skillSlots,
      skills = skillIds.filter((id) => this.ranks[id] < max && (this.ranks[id] > 0 || open));
    return [...skills, ...statIds, ...(this.recoverable ? ['recover' as const] : [])];
  }

  // The first offer is skills only; later ones alternate skill-led and stat-led,
  // and mass release leads whenever the orbit is in danger.
  private offer(number: number): UpgradeId[] {
    const { ranks, boosts } = this,
      count = this.game.rules.growth.choiceCount,
      pool = this.cards.shuffle(this.eligible()),
      skills = pool.filter(isSkill);
    if (number === 1) {
      const cards = skills.slice(0, count),
        lead = cards.find((id) => broad.includes(id)) ?? skills.find((id) => broad.includes(id))!;
      if (!cards.includes(lead)) cards[count - 1] = lead;
      return [lead, ...cards.filter((id) => id !== lead)];
    }
    const existing = skills.filter((id) => ranks[id] > 0).sort((a, b) => ranks[a] - ranks[b]),
      fresh = skills.find((id) => ranks[id] === 0),
      skill = this.ownedSkills.length < 2 ? (fresh ?? existing[0]) : (existing[0] ?? fresh),
      stat = statIds.filter((id) => pool.includes(id)).sort((a, b) => boosts[a] - boosts[b])[0];
    const lead =
      this.game.danger && this.recoverable
        ? 'recover'
        : number % 2
          ? (skill ?? stat)
          : (stat ?? skill);
    const cards: UpgradeId[] = [lead];
    const add = (id: UpgradeId | undefined) => {
      if (id && !cards.includes(id) && cards.length < count) cards.push(id);
    };
    add(isSkill(lead) ? pool.find((id) => !isSkill(id)) : (existing[0] ?? fresh));
    if (!cards.some((id) => isSkill(id) && ranks[id] > 0)) add(existing[0]);
    pool.forEach(add);
    return cards;
  }

  // While a rank-5 skill is unevolved, each offer may carry its evolution; luck raises
  // the chance up to its maximum, and no run of misses forces one.
  private evolutionOffer(): SkillId | undefined {
    const cfg = this.game.rules,
      ready = this.ownedSkills.filter(
        (id) => this.ranks[id] >= cfg.growth.maxRank && !this.evolved[id],
      );
    if (!ready.length || this.cards.next() >= evolutionChance(this.boosts.luck, cfg))
      return undefined;
    return ready[Math.floor(this.cards.next() * ready.length)];
  }

  private pactOffer(number: number): PactId | undefined {
    const cfg = this.game.rules.growth.pacts;
    if (
      number % cfg.interval ||
      this.ownedSkills.length < cfg.minSkills ||
      this.pactCount >= cfg.max
    )
      return undefined;
    const open = pactIds.filter((id) => !this.pacts[id]);
    return open.length ? open[Math.floor(this.cards.next() * open.length)] : undefined;
  }

  // Applies a card that `canUpgrade` accepted, then offers the next unspent level.
  take(card: Card): void {
    const g = this.game,
      id = card.id,
      rate = g.combat.rate;
    if (card.evolve) {
      this.evolved[id as SkillId] = true;
      g.log('evolve', { id: id as SkillId });
    } else if (isPact(id)) {
      this.pacts[id] = true;
      g.combat.pacts.sign(id);
      g.log('pact', { id, mass: g.mass });
    } else if (isSkill(id)) {
      this.rarities[id] ??= card.rarity;
      this.ranks[id]++;
      g.combat.learn(id);
    } else if (isStat(id)) this.boosts[id]++;
    else {
      const removed = g.releaseMass(recoveryMass(card.rarity, g.rules));
      g.log('recover', { removed, mass: g.mass });
    }
    this.refresh();
    if (g.combat.rate !== rate) g.combat.rescale(rate);
    const selection = {
      time: g.time,
      id,
      rank: this.rank(id),
      rarity: card.rarity,
      evolve: !!card.evolve,
    };
    this.selections.push(selection);
    g.log('skill', selection);
    g.addEffect({
      kind: 'upgrade',
      from: id === 'recover' ? CENTER : g.position,
      to: g.position,
      radius: id === 'recover' ? g.core + 14 : id === 'range' ? g.combat.range : 18,
      width: 1,
      life: 0.7,
      source: id,
      rarity: card.rarity,
      anchor: id === 'recover' ? undefined : 'electron',
    });
    this.choice = null;
    this.open();
  }
}
