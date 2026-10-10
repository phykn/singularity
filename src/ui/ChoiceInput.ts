import type { Choice } from '../game/types.ts';

export class ChoiceInput {
  choice: Choice | null = null;
  private opened = Infinity;
  private released = -Infinity;
  private pointers = new Map<number, { choice: Choice | null; allowed: boolean }>();

  show(choice: Choice | null, now: number): void {
    if (choice === this.choice) return;
    this.choice = choice;
    this.opened = now;
  }

  remaining(now: number): number {
    if (!this.choice || this.pointers.size) return Infinity;
    return Math.max(0, this.opened + 450 - now, this.released + 200 - now);
  }

  down(id: number, now: number): boolean {
    const allowed = this.remaining(now) === 0;
    for (const press of this.pointers.values()) press.allowed = false;
    this.pointers.set(id, { choice: this.choice, allowed });
    return allowed;
  }

  up(id: number, now: number, cancelled = false): boolean {
    const press = this.pointers.get(id);
    if (!press) return false;
    this.pointers.delete(id);
    this.released = now;
    return !cancelled && press.allowed && press.choice === this.choice && !this.pointers.size;
  }

  cancel(now: number): void {
    this.pointers.clear();
    this.released = now;
  }
}
