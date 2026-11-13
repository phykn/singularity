import { Random } from '../game/random.ts';

const TAU = Math.PI * 2;
// Wall-clock milliseconds: the first wait, the lead to the first gate, the open window on
// either side of the gate, the rest between rounds and the wait after a cancelled round.
const timing = { intro: 4000, lead: 900, window: 180, restMin: 3200, restMax: 4800, retry: 1200 },
  beats = 3;
// Gaps after the first and second beat; no pattern repeats twice in a row.
const patterns = [
  [550, 850],
  [850, 550],
  [650, 1000],
  [1000, 650],
  [550, 1000],
  [1000, 550],
] as const;
const maxGap = Math.max(timing.lead, ...patterns.flat());

// The beat gate on the orbit: tap while the electron is inside it, three times a round.
// Angles grow without wrapping, so a gate one lap ahead is simply larger.
export class Rhythm {
  active = false;
  age = 0;
  hits = 0;
  // Rounds finished with all three beats.
  completed = 0;
  feedback: 'hit' | 'miss' | 'complete' | null = null;
  feedbackAge = Infinity;
  angle = 0;
  gateAngle = 0;
  // Where the last judged gate stood, for its mark.
  judgmentAngle = 0;
  private velocity = 0.001;
  private lastHit = -Infinity;
  private wait = timing.intro;
  private pattern = -1;
  private readonly random: Random;

  constructor(seed: number) {
    this.random = new Random(seed, 'rhythm');
  }

  // Milliseconds of rhythm age at which the electron reaches the gate.
  get due(): number {
    return this.age + (this.gateAngle - this.angle) / this.velocity;
  }
  get windowAngle(): number {
    return Math.min(Math.PI / 2, this.velocity * timing.window);
  }
  get open(): boolean {
    return (
      this.active &&
      this.age > this.lastHit &&
      Math.abs(this.angle - this.gateAngle) <= this.windowAngle + 1e-9
    );
  }

  // `velocity` is radians per wall millisecond at the current playback speed. An unavailable
  // gate or a long frame cancels the round; `keep` leaves its feedback showing.
  advance(ms: number, available: boolean, angle: number, velocity: number, keep = false): void {
    this.angle = angle;
    this.velocity = Math.max(0.00001, velocity);
    this.feedbackAge += ms;
    if (!available || ms > 250) return this.cancel(keep && ms <= 250);
    if (!this.active) {
      this.wait -= ms;
      if (this.wait > 0) return;
      this.active = true;
      this.age = this.hits = 0;
      this.lastHit = -Infinity;
      const next = Math.floor(this.random.next() * (patterns.length - (this.pattern < 0 ? 0 : 1)));
      this.pattern = this.pattern < 0 || next < this.pattern ? next : next + 1;
      this.placeGate(timing.lead, angle);
      this.feedback = null;
      return;
    }
    this.age += ms;
    if (this.angle - this.gateAngle <= this.windowAngle + 1e-9) return;
    // Before the first hit a passed gate waits a lap; after it, passing is a miss.
    if (this.hits === 0) this.gateAngle += Math.ceil((this.angle - this.gateAngle) / TAU) * TAU;
    else this.finish('miss');
  }

  tap(): 'ignored' | 'hit' | 'complete' | 'miss' {
    if (!this.active || this.age === this.lastHit) return 'ignored';
    if (!this.open) {
      this.finish('miss');
      return 'miss';
    }
    this.hits++;
    this.judgmentAngle = this.gateAngle;
    this.lastHit = this.age;
    this.feedbackAge = 0;
    if (this.hits === beats) {
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
      this.wait = timing.retry;
      this.hits = 0;
    }
    if (!keepFeedback) this.feedback = null;
  }

  // Fast patterns compress into the next visible lap, including the window's far edge.
  private placeGate(ms: number, from: number): void {
    const arc = (TAU - this.windowAngle - 0.1) * (ms / maxGap);
    this.gateAngle = Math.min(from + this.velocity * ms, this.angle + arc);
  }

  private finish(feedback: 'miss' | 'complete'): void {
    this.judgmentAngle = this.gateAngle;
    this.active = false;
    this.feedback = feedback;
    this.feedbackAge = 0;
    this.wait = timing.restMin + this.random.next() * (timing.restMax - timing.restMin);
  }
}
