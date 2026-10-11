import type { Game } from '../game/Game.ts';
import { endingFrame } from '../presentation/ending.ts';
import { beyondFrame } from '../presentation/beyond.ts';
import { SoundMixer } from './sounds.ts';
import type { SoundSpace } from './sounds.ts';
import { CENTER, distance } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';

function soundSpace(point: Point, listener: Point): SoundSpace {
  return { pan: (point.x - CENTER.x) / 520, depth: Math.min(1, distance(point, listener) / 300) };
}

const skillCues: Record<string, string> = {
  strike: 'arc',
  charge: 'charge',
  satellite: 'spark',
  bridge: 'field',
  focus: 'field',
  gather: 'field',
  surge: 'surge',
  vent: 'vent',
};

export class GameAudio {
  private context: AudioContext | null = null;
  private mixer: SoundMixer | null = null;
  private model: Game | null = null;
  private stage = '';
  private wanted = false;
  private request = 0;
  private suspending: Promise<void> | null = null;
  enabled = false;

  async unlock(): Promise<boolean | null> {
    this.wanted = true;
    const request = ++this.request;
    let context: AudioContext | null = null;
    try {
      context = this.context ??= new AudioContext();
      if (this.suspending) await this.suspending;
      if (this.context !== context || request !== this.request) return null;
      await context.resume();
      if (this.context !== context) return null;
      if (!this.wanted) {
        await this.suspendContext(context);
        return null;
      }
      if (request !== this.request) return null;
      this.enabled = context.state === 'running';
      if (this.enabled) this.mixer ??= new SoundMixer(context);
      return this.enabled;
    } catch {
      if (request !== this.request) return null;
      if (this.context === context) this.enabled = false;
      return false;
    }
  }

  suspend(): void {
    this.mixer?.stop(this.context?.currentTime, true);
    this.wanted = false;
    this.request++;
    this.enabled = false;
    if (this.context) void this.suspendContext(this.context);
  }
  private suspendContext(context: AudioContext): Promise<void> {
    const promise = context.suspend().catch(() => {});
    this.suspending = promise;
    void promise.then(() => {
      if (this.suspending === promise) this.suspending = null;
    });
    return promise;
  }
  destroy(): void {
    this.mixer?.dispose();
    this.mixer = null;
    this.model = null;
    this.stage = '';
    const context = this.context;
    this.context = null;
    this.suspending = null;
    this.enabled = false;
    this.wanted = false;
    this.request++;
    void context?.close().catch(() => {});
  }

  update(game: Game, from: number): void {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    this.mixer ??= new SoundMixer(ctx);
    if (this.model !== game) {
      this.mixer.stop();
      this.stage = '';
      this.model = game;
    }
    if (game.paused || game.phase === 'ready') return;
    const crossing = beyondFrame(game);
    if (crossing) {
      const stage = 'beyond-' + crossing.stage;
      if (this.stage !== stage) {
        this.stage = stage;
        this.mixer.stop();
        if (crossing.stage === 'contract') this.play('beyond-contract');
        if (crossing.stage === 'open') this.play('beyond-open');
      }
      return;
    }
    const ending = endingFrame(game);
    if (ending) {
      if (this.stage !== ending.stage) {
        this.stage = ending.stage;
        this.mixer.stop();
        const cues: Record<string, string> = {
          accelerate: 'charged',
          compress: 'ending-compress',
          formation: 'ending',
          settle: 'ending-resonance',
          impact: 'collision',
        };
        const cue = cues[ending.stage];
        if (cue) this.play(cue);
      }
      return;
    }
    this.stage = '';
    for (let i = Math.max(0, from - game.eventOffset); i < game.events.length; i++) {
      const event = game.events[i];
      if (event.kind === 'kill' || event.kind === 'hit') {
        const point = event.data as Point & { kind: string };
        this.play(
          event.kind === 'kill' ? 'kill' : point.kind === 'dense' ? 'dense' : 'hit',
          soundSpace(point, game.position),
        );
      } else if (event.kind === 'skill-effect') {
        const cue = skillCues[(event.data as { id: string }).id];
        if (cue) this.play(cue);
      } else if (['level', 'wave', 'charged'].includes(event.kind)) this.play(event.kind);
    }
  }

  play(kind: string, space?: SoundSpace): void {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    this.mixer ??= new SoundMixer(ctx);
    this.mixer.play(kind, ctx.currentTime, 1, space);
  }
}
