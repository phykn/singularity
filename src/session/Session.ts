import type { Game } from '../game/Game.ts';
import type { UpgradeId } from '../game/rules.ts';
import type { Result } from '../game/types.ts';
import { Rhythm } from './rhythm.ts';

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
// playback speed, pause, the hidden-tab stop, the choice countdown, the beat gate,
// hit stop and the sound cursor.
export class Session {
  game: Game;
  rhythm: Rhythm;
  ready = false;
  paused = false;
  speed: Speed = 1;
  // Combat stops while cards are on offer; when off, they pick themselves after a countdown.
  pauseOnChoice = true;
  choiceLeft = 0;
  private choiceNumber = 0;
  private readonly audio: SessionAudio;
  private readonly hooks: SessionHooks;
  private wall = 0;
  private drawnAt = -Infinity;
  private drawnTick = -1;
  private cursor: number;
  private recorded: Result | null = null;
  // Wall milliseconds the model holds still after an accepted beat.
  private hitStop = 0;

  constructor(game: Game, audio: SessionAudio, hooks: SessionHooks) {
    this.game = game;
    this.audio = audio;
    this.hooks = hooks;
    this.cursor = game.eventCount;
    this.rhythm = new Rhythm(game.seed);
  }

  get rhythmAvailable(): boolean {
    return this.live && this.game.phase === 'running' && !this.game.choice;
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
    this.rhythm = new Rhythm(game.seed);
    this.hitStop = 0;
    this.paused = false;
    this.speed = 1;
    this.choiceNumber = 0;
    this.wall = wall;
    this.drawnTick = -1;
    this.hooks.redraw();
  }

  pause(paused: boolean, wall: number): void {
    this.frame(wall);
    if (this.game.phase === 'ready' || this.game.phase === 'result') return;
    this.paused = paused;
    if (paused) {
      this.rhythm.cancel();
      this.audio.suspend();
    } else if (this.ready && this.hooks.sound()) void this.unlock();
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

  toggleChoicePause(wall: number): void {
    this.frame(wall);
    this.pauseOnChoice = !this.pauseOnChoice;
    this.hooks.redraw();
  }

  // A tap judged against the beat gate; accepted beats resonate and briefly hold time.
  tap(wall: number): void {
    this.frame(wall);
    if (!this.rhythmAvailable || this.game.beatTick === this.game.elapsedTicks) return;
    const result = this.rhythm.tap();
    if (result === 'hit' || result === 'complete') {
      this.game.resonate(this.rhythm.hits as 1 | 2 | 3);
      this.hitStop = result === 'complete' ? 90 : 35;
      if (result === 'complete') this.audio.play('rhythm-complete');
    }
    this.hooks.redraw();
  }

  // A manual pick after its countdown ran out is ignored.
  select(id: UpgradeId, number: number, wall: number): boolean {
    if (!this.live) return false;
    this.frame(wall);
    const taken = (this.pauseOnChoice || this.choiceLeft > 0) && this.game.choose(id, number);
    this.hooks.redraw();
    return taken;
  }

  // The countdown runs on the wall clock, whatever the playback speed.
  private countdown(ms: number): void {
    const choice = this.game.choice;
    if (!choice || this.pauseOnChoice || choice.number !== this.choiceNumber) return;
    this.choiceLeft -= ms;
    const card = this.game.automaticCard;
    if (this.choiceLeft <= 0 && card) this.game.choose(card.id, choice.number);
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
      ms = Math.max(0, wall - this.wall),
      available = this.rhythmAvailable,
      held = Math.min(ms, this.hitStop);
    this.wall = wall;
    this.hitStop -= held;
    if (this.ready && !this.paused) {
      if (game.phase === 'ready')
        game.angle += (game.rules.orbit.speed / game.radius) * (ms / 1000);
      else {
        this.countdown(ms);
        const speed = game.phase === 'crossing' ? 1 : this.speed;
        game.advance((ms - held) * speed, frameTickLimit, this.pauseOnChoice);
        game.pendingTicks = Math.min(game.pendingTicks, 1);
        if (game.choice && game.choice.number !== this.choiceNumber) {
          this.choiceNumber = game.choice.number;
          this.choiceLeft = game.rules.time.choiceSeconds * 1000;
          this.hooks.redraw();
        }
      }
      if (this.audio.enabled) this.audio.update(game, this.cursor);
    }
    this.rhythm.advance(
      ms,
      available && this.rhythmAvailable,
      game.angle,
      (game.rules.orbit.speed / game.radius / 1000) * this.speed,
      Boolean(game.choice) && game.phase === 'running' && !this.paused,
    );
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
