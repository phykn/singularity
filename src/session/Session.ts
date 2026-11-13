import type { Game } from '../game/Game.ts';
import type { UpgradeId } from '../game/rules.ts';
import type { Result } from '../game/types.ts';
import { Rhythm } from './rhythm.ts';

const speeds = [1, 1.5, 2] as const;
// A slow frame advances at most this many ticks and never catches up later.
const frameTickLimit = 8,
  redrawMilliseconds = 80;

export type SessionAudio = {
  enabled: boolean;
  // False when the browser refused to open audio, null when a later request replaced this one.
  unlock(): Promise<boolean | null>;
  suspend(): void;
  update(game: Game, from: number): void;
  play(kind: string): void;
  destroy(): void;
};
type SessionHooks = {
  sound(): boolean;
  // The browser refused to open audio; sound stays off for this page without saving.
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
  speed: (typeof speeds)[number] = 1;
  // Combat stops while cards are on offer; when off, they pick themselves after a countdown.
  pauseOnChoice = true;
  choiceLeft = 0;
  private readonly audio: SessionAudio;
  private readonly hooks: SessionHooks;
  private wall = 0;
  private choiceNumber = 0;
  // Wall milliseconds the model holds still after an accepted beat.
  private hitStop = 0;
  // The event count the audio has heard up to.
  private cursor: number;
  private recorded: Result | null = null;
  private drawnAt = -Infinity;
  private drawnTick = -1;

  constructor(game: Game, audio: SessionAudio, hooks: SessionHooks) {
    this.game = game;
    this.audio = audio;
    this.hooks = hooks;
    this.cursor = game.eventCount;
    this.rhythm = new Rhythm(game.seed);
  }

  get live(): boolean {
    const phase = this.game.phase;
    return this.ready && !this.paused && phase !== 'ready' && phase !== 'result';
  }
  get rhythmAvailable(): boolean {
    return this.live && this.game.phase === 'running' && !this.game.growth.choice;
  }

  setReady(ready: boolean, wall: number): void {
    this.ready = ready;
    this.wall = wall;
    if (!ready) this.audio.suspend();
    else if (this.live) this.openAudio();
    this.hooks.redraw();
  }

  // START is the gesture that lets the browser open audio, so the context opens inside it.
  start(wall: number): void {
    if (!this.ready || this.game.phase !== 'ready') return;
    this.openAudio();
    this.wall = wall;
    this.paused = false;
    this.game.start();
    this.hooks.redraw();
  }

  // A new run under the same session: speed and pause reset, the choice preference stays.
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

  continueBeyond(wall: number): void {
    if (!this.game.continueBeyond()) return;
    this.wall = wall;
    this.paused = false;
    this.rhythm = new Rhythm(this.game.seed ^ this.game.giants.round);
    this.openAudio();
    this.hooks.redraw();
  }

  retire(wall: number): void {
    this.frame(wall);
    this.paused = false;
    if (this.game.retire()) this.frame(wall);
    this.hooks.redraw();
  }

  pause(paused: boolean, wall: number): void {
    this.frame(wall);
    if (this.game.phase === 'ready' || this.game.phase === 'result') return;
    this.paused = paused;
    if (paused) {
      this.rhythm.cancel();
      this.audio.suspend();
    } else if (this.ready) this.openAudio();
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
    if (result === 'miss') this.missBeat();
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

  // Turning sound on at the title plays a preview.
  async setSound(sound: boolean): Promise<void> {
    if (!sound) return this.audio.suspend();
    if (this.game.phase === 'ready') {
      if (await this.unlock()) this.audio.play('preview');
    } else if (this.live) await this.unlock();
  }

  frame(wall: number): void {
    const game = this.game,
      ms = Math.max(0, wall - this.wall),
      available = this.rhythmAvailable,
      held = Math.min(ms, this.hitStop);
    this.wall = wall;
    this.hitStop -= held;
    if (this.ready && !this.paused) {
      // On the title the electron just circles.
      if (game.phase === 'ready')
        game.angle += (game.rules.orbit.speed / game.radius) * (ms / 1000);
      else {
        this.countdown(ms);
        game.advance(
          (ms - held) * (game.phase === 'crossing' ? 1 : this.speed),
          frameTickLimit,
          this.pauseOnChoice,
        );
        game.pendingTicks = Math.min(game.pendingTicks, 1);
        const choice = game.growth.choice;
        if (choice && choice.number !== this.choiceNumber) {
          this.choiceNumber = choice.number;
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
      Boolean(game.growth.choice) && game.phase === 'running' && !this.paused,
    );
    // A gate that passes unanswered after the first hit is a miss too.
    if (this.rhythm.feedback === 'miss' && this.rhythm.feedbackAge === 0) this.missBeat();
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

  // A missed beat costs mass only under the Pulse pact.
  private missBeat(): void {
    if (this.game.growth.pacts.pulse && this.rhythmAvailable) this.game.resonate(0);
  }

  // The countdown runs on the wall clock, whatever the playback speed.
  private countdown(ms: number): void {
    const growth = this.game.growth,
      choice = growth.choice;
    if (!choice || this.pauseOnChoice || choice.number !== this.choiceNumber) return;
    this.choiceLeft -= ms;
    const card = growth.automaticCard;
    if (this.choiceLeft <= 0 && card) this.game.choose(card.id, choice.number);
  }

  private openAudio(): void {
    if (this.hooks.sound()) void this.unlock();
  }

  private async unlock(): Promise<boolean | null> {
    const enabled = await this.audio.unlock();
    if (enabled === false) this.hooks.audioFailed();
    return enabled;
  }
}
