export const rhythmTiming = {
  intro: 4000,
  lead: 900,
  interval: 700,
  window: 150,
  rest: 12000,
  beats: 3,
};

export class OrbitRhythm {
  active = false;
  age = 0;
  hits = 0;
  completed = 0;
  feedback: 'hit' | 'miss' | 'complete' | null = null;
  feedbackAge = Infinity;
  private wait = rhythmTiming.intro;

  get due(): number {
    return rhythmTiming.lead + this.hits * rhythmTiming.interval;
  }

  get open(): boolean {
    return this.active && Math.abs(this.age - this.due) <= rhythmTiming.window;
  }

  advance(ms: number, available: boolean): void {
    if (!available || ms > 250) {
      this.cancel();
      return;
    }
    this.feedbackAge += ms;
    if (!this.active) {
      this.wait -= ms;
      if (this.wait <= 0) {
        this.active = true;
        this.age = this.hits = 0;
        this.feedback = null;
      }
      return;
    }
    this.age += ms;
    if (this.age > this.due + rhythmTiming.window) this.finish('miss');
  }

  tap(): 'ignored' | 'hit' | 'complete' | 'miss' {
    if (!this.active) return 'ignored';
    if (!this.open) {
      this.finish('miss');
      return 'miss';
    }
    this.hits++;
    this.feedbackAge = 0;
    if (this.hits === rhythmTiming.beats) {
      this.completed++;
      this.finish('complete');
      return 'complete';
    }
    this.feedback = 'hit';
    return 'hit';
  }

  cancel(): void {
    if (this.active) {
      this.active = false;
      this.wait = 1200;
      this.hits = 0;
    }
    this.feedback = null;
  }

  private finish(feedback: 'miss' | 'complete'): void {
    this.active = false;
    this.feedback = feedback;
    this.feedbackAge = 0;
    this.wait = rhythmTiming.rest;
  }
}
