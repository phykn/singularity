import type { Point } from './geometry.ts';
import type { BossKind } from './bosses.ts';
import type { ParticleKind } from './particles.ts';
import type { Boosts, Rarity, Ranks, SkillId, UpgradeId } from './rules.ts';

export type Phase = 'ready' | 'running' | 'collapse' | 'ending' | 'result' | 'crossing';
// Stored in best records; keep these strings.
export type Outcome = 'success' | 'collapse-failure' | 'retired';
export type BannerKind = 'critical' | 'boss' | 'boss-down' | 'slot-open' | 'final-boss';
export type Target = Point & {
  id: number;
  kind: 'small' | 'dense' | 'boss';
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
export type Event = { time: number; kind: string; data: Record<string, unknown> };
// Inputs land between ticks: `tick` is the elapsed tick count when they were applied.
export type Input = { tick: number } & (
  | { kind: 'card'; id: UpgradeId; number: number }
  | { kind: 'beat'; beat: 0 | 1 | 2 | 3 }
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
  trigger: 'gravity' | 'boss-absorbed' | 'boss' | 'quit';
  ranks: Ranks;
  boosts: Boosts;
  rarities: Partial<Record<UpgradeId, Rarity>>;
  evolved: Partial<Record<SkillId, boolean>>;
  selections: Selection[];
  endless: { seconds: number; xp: number } | null;
};
