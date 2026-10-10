import { Random } from '../game/random.ts';

export const rhythmTiming = {
  intro: 4000,
  lead: 900,
  window: 180,
  restMin: 3200,
  restMax: 4800,
  beats: 3,
};

const patterns = [
  [550, 850],
  [850, 550],
  [650, 1000],
  [1000, 650],
  [550, 1000],
  [1000, 550],
] as const;
const maxGap = Math.max(rhythmTiming.lead, ...patterns.flat());

export class OrbitRhythm {
  active = false;
  age = 0;
  hits = 0;
  completed = 0;
  feedback: 'hit' | 'miss' | 'complete' | null = null;
  feedbackAge = Infinity;
  angle = 0;
  gateAngle = 0;
  hitAngle = 0;
  judgmentAngle = 0;
  private velocity = 0.001;
  private lastHit = -Infinity;
  private wait = rhythmTiming.intro;
  private readonly random: Random;
  private pattern = -1;

  constructor(seed = 0) {
    this.random = new Random(seed ^ 0x72687974);
  }

  get due(): number {
    return this.age + (this.gateAngle - this.angle) / this.velocity;
  }

  get windowAngle(): number {
    return Math.min(Math.PI / 2, this.velocity * rhythmTiming.window);
  }

  get open(): boolean {
    return (
      this.active &&
      this.age > this.lastHit &&
      Math.abs(this.angle - this.gateAngle) <= this.windowAngle + 1e-9
    );
  }

  advance(
    ms: number,
    available: boolean,
    angle: number,
    velocity: number,
    keepFeedback = false,
  ): void {
    this.angle = angle;
    this.velocity = Math.max(0.00001, velocity);
    this.feedbackAge += ms;
    if (!available || ms > 250) {
      this.cancel(keepFeedback && ms <= 250);
      return;
    }
    if (!this.active) {
      this.wait -= ms;
      if (this.wait <= 0) {
        this.active = true;
        this.age = this.hits = 0;
        this.lastHit = -Infinity;
        const next = Math.floor(
          this.random.next() * (patterns.length - (this.pattern < 0 ? 0 : 1)),
        );
        this.pattern = this.pattern < 0 || next < this.pattern ? next : next + 1;
        this.placeGate(rhythmTiming.lead, angle);
        this.feedback = null;
      }
      return;
    }
    this.age += ms;
    if (this.angle - this.gateAngle > this.windowAngle + 1e-9) {
      if (this.hits === 0) {
        this.gateAngle += Math.ceil((this.angle - this.gateAngle) / (Math.PI * 2)) * Math.PI * 2;
      } else this.finish('miss');
    }
  }

  tap(): 'ignored' | 'hit' | 'complete' | 'miss' {
    if (!this.active) return 'ignored';
    if (this.age === this.lastHit) return 'ignored';
    if (!this.open) {
      this.finish('miss');
      return 'miss';
    }
    this.hits++;
    this.hitAngle = this.gateAngle;
    this.judgmentAngle = this.gateAngle;
    this.lastHit = this.age;
    this.feedbackAge = 0;
    if (this.hits === rhythmTiming.beats) {
      this.completed++;
      this.finish('complete');
      return 'complete';
    }
    this.feedback = 'hit';
    this.placeGate(patterns[this.pattern][this.hits - 1], this.gateAngle);
    return 'hit';
  }

  cancel(keepFeedback = false): void {
    if (this.active) {
      this.active = false;
      this.wait = 1200;
      this.hits = 0;
    }
    if (!keepFeedback) this.feedback = null;
  }

  private placeGate(ms: number, from: number): void {
    // Compress fast patterns into the next visible lap, including the window's far edge.
    const arc = (Math.PI * 2 - this.windowAngle - 0.1) * (ms / maxGap);
    this.gateAngle = Math.min(from + this.velocity * ms, this.angle + arc);
  }

  private finish(feedback: 'miss' | 'complete'): void {
    this.judgmentAngle = this.gateAngle;
    this.active = false;
    this.feedback = feedback;
    this.feedbackAge = 0;
    this.wait =
      rhythmTiming.restMin + this.random.next() * (rhythmTiming.restMax - rhythmTiming.restMin);
  }
}
