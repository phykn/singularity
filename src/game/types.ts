import type { Point } from './geometry.ts';
import type { ParticleKind } from './particles.ts';
import type { BossKind } from './bosses.ts';
import type { Boosts, Card, Ranks, Rarities, Rarity, UpgradeId } from './rules.ts';

export type TargetKind = 'small' | 'dense' | 'boss';
export type BannerKind = 'critical' | 'boss' | 'boss-down' | 'slot-open' | 'final-boss';
export type Phase = 'ready' | 'running' | 'collapse' | 'ending' | 'result' | 'crossing';
export type Target = Point & {
  id: number;
  kind: TargetKind;
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
  final?: boolean;
  boss?: BossKind;
  // The gluon that holds this quark; the gluon takes less damage while any are held.
  tether?: number;
  // A neutrino's first hit only reveals it.
  veiled?: boolean;
  // Set once a particle has taken mass from the Higgs field.
  higgs?: boolean;
  summons?: number;
  summonCount?: number;
  // Next time the overclock current trail may zap this particle.
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
  // Seconds after birth before the effect appears; kills in one tick pop in sequence.
  delay?: number;
};
export type EffectInput = Omit<Effect, 'born' | 'rank' | 'rarity' | 'damage'> &
  Partial<Pick<Effect, 'rank' | 'rarity' | 'damage'>>;
export type DamageNumber = Point & { id: number; value: number; born: number; crit?: boolean };
export type Choice = { cards: Card[]; number: number; opened: number; deadline: number };
export type Count = { generated: number; killed: number; absorbed: number };
export type Outcome = 'success' | 'collapse-failure' | 'retired';
export type Selection = {
  tick: number;
  time: number;
  id: UpgradeId;
  rank: number;
  rarity: Rarity;
  automatic: boolean;
  beforeCombat: boolean;
  evolve: boolean;
};
export type Metrics = {
  minRadius: number;
  minMargin: number;
  dangerSeconds: number;
  maxTargets: number;
  maxEffects: number;
};
export type Result = {
  endless: { seconds: number; xp: number } | null;
  outcome: Outcome;
  trigger: 'gravity' | 'boss' | 'quit';
  xp: number;
  mass: number;
  radius: number;
  level: number;
  seed: number;
  ranks: Ranks;
  boosts: Boosts;
  rarities: Rarities;
  score: number;
  rushSpawns: number;
  seconds: number;
  collisionTime: number;
  waves: number;
  counts: Record<ParticleKind, Count & { remaining: number }>;
  selections: Selection[];
  metrics: Metrics;
};
export type SkillStatus = {
  mode: 'linked' | 'timed' | 'conditional' | 'charging';
  progress: number;
  active: boolean;
  fired: boolean;
};
export type Member = {
  kind: 'small' | 'dense';
  particle: ParticleKind;
  angle: number;
  radius: number;
  hp: number;
  xp: number;
  mass: number;
  size: number;
  speed: number;
  turn: number;
  tether?: number;
};
// A formation shown as faint dots before its members appear.
export type PendingSpawn = { planned: number; time: number; members: Member[]; wave?: number };
export type Event = { time: number; kind: string; data: unknown };
