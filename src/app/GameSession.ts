import type { Game } from '../game/Game.ts';
import type { UpgradeId } from '../game/rules.ts';
import type { Result } from '../game/types.ts';
import type { GameAudio } from './GameAudio.ts';
import { OrbitRhythm } from './OrbitRhythm.ts';

type SessionEffects = {
  sound: () => boolean;
  saveResult: (result: Result) => boolean;
  redraw: () => void;
};

const frameTickLimit = 8;
type SessionAudio = Pick<GameAudio, 'enabled' | 'update' | 'unlock' | 'suspend' | 'destroy'> &
  Partial<Pick<GameAudio, 'play'>>;

export class GameSession {
  game: Game;
  renderReady = false;
  playbackSpeed: 1 | 1.5 | 2 = 1;
  pauseOnChoice = true;
  rhythm: OrbitRhythm;
  private audio: SessionAudio;
  private effects: SessionEffects;
  private lastWall = 0;
  private lastDraw = 0;
  private lastDrawTick = -1;
  private processed = new WeakSet<Result>();
  private pending = new Map<Result, number>();
  private audioCursor: number;
  private hitStop = 0;

  constructor(game: Game, audio: GameSession['audio'], effects: SessionEffects) {
    this.game = game;
    this.rhythm = new OrbitRhythm(game.seed);
    this.audio = audio;
    this.effects = effects;
    this.audioCursor = game.eventCount;
  }

  setRenderReady(ready: boolean, wall: number): void {
    this.renderReady = ready;
    this.lastWall = wall;
    if (!ready) {
      this.rhythm.cancel();
      this.audio.suspend();
    } else if (this.effects.sound() && !this.game.paused && this.game.phase !== 'ready')
      void this.audio.unlock();
    this.effects.redraw();
  }

  begin(wall: number): void {
    if (!this.renderReady || this.game.paused || this.game.phase !== 'ready') return;
    this.lastWall = wall;
    this.game.start();
    this.effects.redraw();
  }

  replace(game: Game, wall: number): void {
    this.game.retire();
    this.saveResults(wall);
    this.game = game;
    this.rhythm = new OrbitRhythm(game.seed);
    this.hitStop = 0;
    this.playbackSpeed = 1;
    this.pauseOnChoice = true;
    this.lastWall = wall;
    this.lastDrawTick = -1;
    this.audioCursor = 0;
    this.effects.redraw();
  }

  continueBeyond(wall: number): void {
    if (!this.renderReady) return;
    this.step(wall);
    if (!this.game.continueBeyond()) return;
    this.rhythm = new OrbitRhythm(this.game.seed);
    this.hitStop = 0;
    this.lastWall = wall;
    this.effects.redraw();
  }

  pause(paused: boolean, wall: number): void {
    this.step(wall);
    this.game.setManualPause(paused);
    this.lastWall = wall;
    if (paused) {
      this.rhythm.cancel();
      this.audio.suspend();
    }
    this.effects.redraw();
  }

  select(id: UpgradeId, number: number, wall = this.lastWall): void {
    if (!this.renderReady) return;
    this.step(wall);
    this.game.select(id, false, number);
    this.effects.redraw();
  }

  cycleSpeed(wall: number): void {
    this.step(wall);
    this.rhythm.cancel();
    this.playbackSpeed = this.playbackSpeed === 1 ? 1.5 : this.playbackSpeed === 1.5 ? 2 : 1;
    this.effects.redraw();
  }

  toggleChoicePause(wall: number): void {
    if (!this.renderReady || this.game.paused) return;
    this.step(wall);
    this.pauseOnChoice = !this.pauseOnChoice;
    this.step(wall);
    this.effects.redraw();
  }

  get rhythmAvailable(): boolean {
    const game = this.game;
    return (
      this.renderReady && game.phase === 'running' && !game.paused && !game.choice && !game.charged
    );
  }

  tapRhythm(wall: number): void {
    this.step(wall);
    if (!this.rhythmAvailable || this.game.resonances.at(-1)?.tick === this.game.elapsedTicks)
      return;
    const result = this.rhythm.tap();
    if (result === 'hit' || result === 'complete') {
      this.game.resonate(this.rhythm.hits as 1 | 2 | 3);
      this.hitStop = result === 'complete' ? 90 : 35;
      this.audio.play?.(result === 'complete' ? 'rhythm-complete' : 'rhythm-' + this.rhythm.hits);
      if (result === 'complete') this.audio.play?.('rhythm-crack');
    } else if (result === 'miss') this.audio.play?.('rhythm-miss');
    this.effects.redraw();
  }

  setHidden(hidden: boolean, wall: number): void {
    if (this.renderReady && hidden && !this.game.hiddenPaused) this.step(wall);
    this.game.setHidden(hidden);
    this.lastWall = wall;
    if (hidden) {
      this.rhythm.cancel();
      this.audio.suspend();
    } else if (this.renderReady && this.effects.sound() && !this.game.manualPaused)
      void this.audio.unlock();
    this.effects.redraw();
  }

  suspend(wall: number): void {
    this.rhythm.cancel();
    this.game.setHidden(true);
    this.lastWall = wall;
    this.audio.suspend();
  }

  step(wall: number): void {
    const game = this.game;
    const available = this.rhythmAvailable;
    const ms = Math.max(0, wall - this.lastWall);
    const stopping = this.hitStop > 0;
    const held = Math.min(ms, this.hitStop);
    this.hitStop -= held;
    if (this.renderReady) {
      if (game.phase === 'ready') {
        if (!game.paused) game.angle += (game.speed / game.radius) * (ms / 1000);
      } else if (!stopping || ms > held) this.advanceTime(ms - held, frameTickLimit);
    }
    this.rhythm.advance(
      ms,
      available && this.rhythmAvailable,
      game.angle,
      (game.speed / game.radius / 1000) * this.playbackSpeed,
      (Boolean(game.choice) || game.charged) && game.phase === 'running' && !game.paused,
    );
    this.lastWall = wall;
    if (this.audio.enabled) this.audio.update(game, this.audioCursor);
    this.audioCursor = game.eventCount;
    this.saveResults(wall);
    if (
      wall - this.lastDraw > 80 &&
      (game.elapsedTicks !== this.lastDrawTick || (game.choice && this.renderReady && !game.paused))
    ) {
      this.effects.redraw();
      this.lastDraw = wall;
      this.lastDrawTick = game.elapsedTicks;
    }
  }

  advance(ms: number, wall: number): void {
    this.game.advance(ms);
    this.lastWall = wall;
    this.effects.redraw();
  }

  private saveResults(wall: number): void {
    for (const result of [this.game.clearResult, this.game.result]) {
      if (result && !this.processed.has(result) && !this.pending.has(result))
        this.pending.set(result, -Infinity);
    }
    for (const [result, at] of this.pending) {
      if (wall - at < 1000) continue;
      if (this.effects.saveResult(result)) {
        this.processed.add(result);
        this.pending.delete(result);
      } else this.pending.set(result, wall);
    }
  }

  private advanceTime(ms: number, tickLimit = Infinity): void {
    this.game.advance(
      this.pauseOnChoice && this.game.choice && !this.game.charged
        ? 0
        : ms * (this.game.phase === 'crossing' ? 1 : this.playbackSpeed),
      tickLimit,
      {
        choiceMilliseconds: this.pauseOnChoice ? 0 : ms,
        stopAtChoice: this.pauseOnChoice,
      },
    );
  }

  dispose(): void {
    this.audio.destroy();
  }
}
