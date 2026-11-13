import type { FormationId } from './formations.ts';
import type { Family } from './particles.ts';
import type { BossKind, PactId, ParticleKind, PopStyle, SkillId } from './rules.ts';
import type { Beat, Card, Outcome, Selection, Trigger } from './types.ts';

type Arrival = { id: number; hp: number; boss: BossKind };
type Struck = { id: number; kind: Family | 'boss'; particle: ParticleKind };

// Every event the model logs, by kind. Views and sound read the log; nothing else is told.
export type Events = {
  start: { seed: number };
  beyond: { round: number };
  'beyond-ready': Record<string, never>;
  rush: { count: number };
  wave: { number: number; angle: number };
  formation: { shape: FormationId; wave?: number; count: number };
  spawn: { placed: { id: number; particle: ParticleKind; angle: number; hp: number }[] };
  boss: Arrival;
  'final-boss': Arrival;
  charged: { time: number };
  critical: { time: number };
  convert: { id: number; ids: number[] };
  round: { round: number; time: number };
  absorb: Struck & { mass: number };
  'boss-absorbed': { id: number; mass: number };
  reveal: { id: number; x: number; y: number };
  hit: Struck & { damage: number; x: number; y: number; crit?: boolean };
  kill: Struck & { xp: number; x: number; y: number; delay: number; style: PopStyle };
  'boss-down': { id: number; slots: number };
  'final-boss-down': { id: number };
  level: { level: number; xp: number };
  cards: { number: number; cards: Card[] };
  skill: Selection;
  evolve: { id: SkillId };
  pact: { id: PactId; mass: number };
  recover: { removed: number; mass: number };
  resonance: { beat: Beat };
  release: { shots: number };
  thunder: { count: number };
  build: { id: 'charge' | 'surge' | 'overcharge'; step: number };
  'skill-effect': { id: SkillId; rank: number };
  collision: { trigger: Trigger; outcome: Outcome; xp: number; mass: number };
  ending: { outcome: Outcome };
  result: { outcome: Outcome };
};
export type EventKind = keyof Events;
export type Event = { [K in EventKind]: { time: number; kind: K; data: Events[K] } }[EventKind];
