import type { Game } from '../game/model.ts';
import type { UpgradeId } from '../game/rules.ts';
import type { Result } from '../game/types.ts';
import type { GameAudio } from './audio.ts';

type SessionEffects = {
  sound: () => boolean;
  saveResult: (result: Result) => boolean;
  redraw: () => void;
};

const frameTickLimit = 8;

export class GameSession {
  game: Game;
  renderReady = false;
  playbackSpeed: 1 | 1.5 | 2 = 1;
  pauseOnChoice = true;
  private audio: Pick<GameAudio, 'enabled' | 'update' | 'unlock' | 'suspend' | 'destroy'>;
  private effects: SessionEffects;
  private lastWall = 0;
  private lastDraw = 0;
  private lastDrawTick = -1;
  private lastRecordSave = -Infinity;
  private processed: Game | null = null;
  private heard: number;

  constructor(game: Game, audio: GameSession['audio'], effects: SessionEffects) {
    this.game = game;
    this.audio = audio;
    this.effects = effects;
    this.heard = game.events.length;
  }

  setRenderReady(ready: boolean, wall: number): void {
    this.renderReady = ready;
    this.lastWall = wall;
    if (!ready) {
      this.audio.suspend();
    } else if (this.effects.sound() && !this.game.paused && this.game.phase !== 'ready')
      void this.audio.unlock();
    this.effects.redraw();
  }

  begin(wall: number): void {
    if (!this.renderReady) return;
    this.lastWall = wall;
    this.game.start();
    this.effects.redraw();
  }

  replace(game: Game, wall: number): void {
    this.game = game;
    this.playbackSpeed = 1;
    this.pauseOnChoice = true;
    this.lastWall = wall;
    this.lastDrawTick = -1;
    this.heard = 0;
    this.processed = null;
    this.lastRecordSave = -Infinity;
    this.effects.redraw();
  }

  pause(paused: boolean, wall: number): void {
    this.step(wall);
    this.game.setManualPause(paused);
    this.lastWall = wall;
    if (paused) this.audio.suspend();
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

  setHidden(hidden: boolean, wall: number): void {
    if (this.renderReady && hidden && !this.game.hiddenPaused) this.step(wall);
    this.game.setHidden(hidden);
    this.lastWall = wall;
    if (hidden) {
      this.audio.suspend();
    } else if (this.renderReady && this.effects.sound() && !this.game.manualPaused)
      void this.audio.unlock();
    this.effects.redraw();
  }

  suspend(wall: number): void {
    this.game.setHidden(true);
    this.lastWall = wall;
    this.audio.suspend();
  }

  step(wall: number): void {
    const game = this.game;
    if (this.renderReady) this.advanceTime(Math.max(0, wall - this.lastWall), frameTickLimit);
    this.lastWall = wall;
    if (this.audio.enabled) this.audio.update(game, this.heard);
    this.heard = game.events.length;
    if (game.result && this.processed !== game && wall - this.lastRecordSave >= 1000) {
      if (this.effects.saveResult(game.result)) this.processed = game;
      this.lastRecordSave = wall;
    }
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

  private advanceTime(ms: number, tickLimit = Infinity): void {
    this.game.advance(
      this.pauseOnChoice && this.game.choice && !this.game.charged ? 0 : ms * this.playbackSpeed,
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
