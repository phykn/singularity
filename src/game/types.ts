import type { Point } from './geometry.ts';
import type { Family } from './particles.ts';
import type { BossKind, PactId, ParticleKind, Rarity, SkillId, UpgradeId } from './rules.ts';
import type { Boosts, Ranks, Rarities } from './skills.ts';

export type Phase = 'ready' | 'running' | 'collapse' | 'ending' | 'result' | 'crossing';
// Stored in best records; keep these strings.
export type Outcome = 'success' | 'collapse-failure' | 'retired';
export type Trigger = 'gravity' | 'boss-absorbed' | 'boss' | 'quit';
export type BannerKind = 'critical' | 'boss' | 'boss-down' | 'slot-open' | 'final-boss';
export type Card = { id: UpgradeId; rarity: Rarity; evolve?: boolean };
export type Choice = { cards: Card[]; number: number };

export type Target = Point & {
  id: number;
  kind: Family | 'boss';
  particle: ParticleKind;
  born: number;
  hp: number;
  maxHp: number;
  xp: number;
  mass: number;
  size: number;
  radius: number;
  angle: number;
  speed: number;
  turn: number;
  hitAt?: number;
  boss?: BossKind;
  final?: boolean;
  // The gluon that holds this quark; the gluon takes less damage while any are held.
  tether?: number;
  // A veiled particle's first hit only reveals it.
  veiled?: boolean;
  // Set once a particle has taken mass from the Higgs field.
  higgs?: boolean;
  summons?: number;
  summonCount?: number;
  // When the Overclock current may zap this particle again.
  trailReady?: number;
  marked?: boolean;
};

export type Effect = {
  kind:
    | 'bolt'
    | 'pierce'
    | 'strike'
    | 'trail'
    | 'charge'
    | 'field'
    | 'surge'
    | 'return'
    | 'kill'
    | 'level'
    | 'upgrade'
    | 'absorb'
    | 'convert';
  from: Point;
  to: Point;
  radius: number;
  width: number;
  damage: number;
  born: number;
  life: number;
  source?: UpgradeId;
  rank: number;
  rarity: Rarity;
  targetId?: number;
  // Ends that follow the electron or a satellite (its index) while the effect shows.
  anchor?: 'electron' | number;
  endAnchor?: 'electron' | number;
  arc?: { start: number; sweep: number };
  particle?: ParticleKind;
  boss?: BossKind;
  // Seconds after birth before the effect shows; kills of one tick pop in sequence.
  delay?: number;
};
export type EffectInput = Omit<Effect, 'born' | 'rank' | 'rarity' | 'damage'> &
  Partial<Pick<Effect, 'rank' | 'rarity' | 'damage'>>;
export type DamageNumber = Point & { id: number; value: number; born: number; crit?: boolean };

// Inputs land between ticks: `tick` is the elapsed tick count when they were applied.
// Beat 0 is a missed beat.
export type Beat = 0 | 1 | 2 | 3;
export type Input = { tick: number } & (
  | { kind: 'card'; id: UpgradeId; number: number }
  | { kind: 'beat'; beat: Beat }
  | { kind: 'beyond' }
  | { kind: 'retire' }
);
export type RunRecord = { seed: number; rules: string; ticks: number; inputs: Input[] };
export type Selection = {
  time: number;
  id: UpgradeId;
  rank: number;
  rarity: Rarity;
  evolve: boolean;
};
export type Result = {
  outcome: Outcome;
  xp: number;
  level: number;
  mass: number;
  seed: number;
  collisionTime: number;
  seconds: number;
  round: number;
  trigger: Trigger;
  ranks: Ranks;
  boosts: Boosts;
  rarities: Rarities;
  evolved: Partial<Record<SkillId, boolean>>;
  pacts: Partial<Record<PactId, boolean>>;
  selections: Selection[];
  endless: { seconds: number; xp: number } | null;
};
