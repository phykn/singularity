import type { Point } from './geometry.ts';
import type { ParticleKind } from './particles.ts';
import type { Boosts, Card, Ranks, Rarities, Rarity, UpgradeId } from './rules.ts';

export type TargetKind = 'small' | 'dense';
export type Phase = 'ready' | 'running' | 'collapse' | 'ending' | 'result';
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
  charge?: number;
  stunUntil?: number;
  stunReady?: number;
  pushReady?: number;
  gatherReady?: number;
  controlCount?: number;
};
export type Effect = {
  kind:
    | 'bolt'
    | 'pierce'
    | 'strike'
    | 'orb'
    | 'bridge'
    | 'charge'
    | 'stun'
    | 'surge'
    | 'return'
    | 'focus'
    | 'kill'
    | 'level'
    | 'upgrade'
    | 'absorb';
  from: Point;
  to: Point;
  radius: number;
  width: number;
  born: number;
  life: number;
  source?: UpgradeId;
  rank: number;
  rarity: Rarity;
  targetId?: number;
  anchor?: 'electron';
};
export type EffectInput = Omit<Effect, 'born' | 'rank' | 'rarity'> &
  Partial<Pick<Effect, 'rank' | 'rarity'>>;
export type DamageNumber = Point & { id: number; value: number; born: number; rarity: Rarity };
export type Choice = { cards: Card[]; number: number; opened: number; deadline: number };
export type Count = { generated: number; killed: number; absorbed: number };
export type Outcome = 'success' | 'collapse-failure';
export type Selection = {
  time: number;
  id: UpgradeId;
  rank: number;
  rarity: Rarity;
  automatic: boolean;
};
export type Metrics = {
  minRadius: number;
  minMargin: number;
  dangerSeconds: number;
  maxTargets: number;
  maxEffects: number;
};
export type Result = {
  outcome: Outcome;
  trigger: 'gravity' | 'energy';
  xp: number;
  mass: number;
  radius: number;
  level: number;
  speed: number;
  missingXp: number;
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
export type Event = { time: number; kind: string; data: unknown };
export type Checkpoint = {
  seed: number;
  ticks: number;
  phase: Exclude<Phase, 'ready'>;
  manualPaused: boolean;
  inputs: { tick: number; id: UpgradeId; number: number }[];
};
