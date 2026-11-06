import type { Game } from '../game/Game.ts';
import type { Result } from '../game/types.ts';

export const speeds = [1, 1.5, 2] as const;
export type Speed = (typeof speeds)[number];
// A slow frame advances at most this many ticks and never catches up later.
export const frameTickLimit = 8;
const redrawMilliseconds = 80;

export type SessionAudio = {
  enabled: boolean;
  unlock(): Promise<boolean | null>;
  suspend(): void;
  update(game: Game, from: number): void;
  play(kind: string): void;
  destroy(): void;
};
export type SessionHooks = {
  sound(): boolean;
  // The browser refused to open audio; sound stays off for this run without saving.
  audioFailed(): void;
  record(result: Result): void;
  redraw(): void;
};

// Drives the model from wall-clock milliseconds. Owns what is not game state:
// playback speed, pause, the hidden-tab stop and the sound cursor.
export class Session {
  game: Game;
  ready = false;
  paused = false;
  speed: Speed = 1;
  private readonly audio: SessionAudio;
  private readonly hooks: SessionHooks;
  private wall = 0;
  private drawnAt = -Infinity;
  private drawnTick = -1;
  private cursor: number;
  private recorded: Result | null = null;

  constructor(game: Game, audio: SessionAudio, hooks: SessionHooks) {
    this.game = game;
    this.audio = audio;
    this.hooks = hooks;
    this.cursor = game.eventCount;
  }

  get live(): boolean {
    return (
      this.ready && !this.paused && this.game.phase !== 'ready' && this.game.phase !== 'result'
    );
  }

  setReady(ready: boolean, wall: number): void {
    this.ready = ready;
    this.wall = wall;
    if (!ready) this.audio.suspend();
    else if (this.live && this.hooks.sound()) void this.unlock();
    this.hooks.redraw();
  }

  // START is the gesture that lets the browser open audio, so the context opens inside it.
  start(wall: number): void {
    if (!this.ready || this.game.phase !== 'ready') return;
    if (this.hooks.sound()) void this.unlock();
    this.wall = wall;
    this.paused = false;
    this.game.start();
    this.hooks.redraw();
  }

  replace(game: Game, wall: number): void {
    this.audio.suspend();
    this.game = game;
    this.cursor = game.eventCount;
    this.paused = false;
    this.speed = 1;
    this.wall = wall;
    this.drawnTick = -1;
    this.hooks.redraw();
  }

  pause(paused: boolean, wall: number): void {
    this.frame(wall);
    if (this.game.phase === 'ready' || this.game.phase === 'result') return;
    this.paused = paused;
    if (paused) this.audio.suspend();
    else if (this.ready && this.hooks.sound()) void this.unlock();
    this.hooks.redraw();
  }

  // A hidden tab pauses and stays paused when it returns.
  hide(wall: number): void {
    if (this.live) this.pause(true, wall);
    else this.audio.suspend();
  }

  cycleSpeed(wall: number): void {
    this.frame(wall);
    this.speed = speeds[(speeds.indexOf(this.speed) + 1) % speeds.length];
    this.hooks.redraw();
  }

  async setSound(sound: boolean): Promise<void> {
    if (!sound) return this.audio.suspend();
    if (this.game.phase === 'ready') {
      if (await this.unlock()) this.audio.play('preview');
    } else if (this.live) await this.unlock();
  }

  private async unlock(): Promise<boolean | null> {
    const enabled = await this.audio.unlock();
    if (enabled === false) this.hooks.audioFailed();
    return enabled;
  }

  frame(wall: number): void {
    const game = this.game,
      ms = Math.max(0, wall - this.wall);
    this.wall = wall;
    if (this.ready && !this.paused) {
      if (game.phase === 'ready')
        game.angle += (game.rules.orbit.speed / game.radius) * (ms / 1000);
      else {
        game.advance(ms * (game.phase === 'crossing' ? 1 : this.speed), frameTickLimit);
        game.pendingTicks = Math.min(game.pendingTicks, 1);
      }
      if (this.audio.enabled) this.audio.update(game, this.cursor);
    }
    this.cursor = game.eventCount;
    if (game.result && game.result !== this.recorded) {
      this.recorded = game.result;
      this.hooks.record(game.result);
    }
    if (wall - this.drawnAt > redrawMilliseconds && game.elapsedTicks !== this.drawnTick) {
      this.drawnAt = wall;
      this.drawnTick = game.elapsedTicks;
      this.hooks.redraw();
    }
  }

  dispose(): void {
    this.audio.destroy();
  }
}
