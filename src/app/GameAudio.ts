import type { Game } from '../game/Game.ts';
import { endingFrame } from '../presentation/ending.ts';
import { beyondFrame } from '../presentation/beyond.ts';
import { SoundMixer } from '../audio/SoundMixer.ts';
import type { SoundCue, SoundSpace } from '../audio/SoundComposer.ts';
import { CENTER, distance } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import { particleIds } from '../game/particles.ts';
import type { ParticleKind } from '../game/particles.ts';
import type { PopStyle } from '../game/skills.ts';

function soundSpace(point: Point, listener: Point): SoundSpace {
  return { pan: (point.x - CENTER.x) / 520, depth: Math.min(1, distance(point, listener) / 300) };
}

// Each pop style has its keystroke: a full tap, two keys slammed together,
// a roll onto the neighbouring key, the enter key struck hard, a light brush.
const popCues: Record<PopStyle, string> = {
  tap: 'pop',
  burst: 'slam',
  domino: 'roll',
  release: 'enter',
  sweep: 'brush',
};
// Some particles sound like their own key whatever popped them.
const particleCues: Partial<Record<ParticleKind, string>> = {
  neutron: 'space',
  neutrino: 'lift',
  meson: 'double',
};

const eventCues: Record<string, string> = {
  wave: 'wave',
  critical: 'wave',
  boss: 'wave',
  'final-boss': 'wave',
  charged: 'charged',
  'boss-down': 'charged',
  evolve: 'charged',
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
    this.stage = '';
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
      const stage = crossing.stage;
      this.enter(
        'beyond-' + stage,
        stage === 'contract' || stage === 'open' ? 'beyond-' + stage : '',
      );
      return;
    }
    const ending = endingFrame(game);
    if (ending) {
      if (ending.success) {
        const singing = game.phase === 'collapse' && !ending.quiet;
        this.enter(singing ? 'singularity' : 'silence', singing ? 'singularity' : '');
      } else this.enter(ending.stage, ending.stage === 'impact' ? 'collision' : '');
      return;
    }
    this.stage = '';
    const cues: SoundCue[] = [];
    const listener = game.position;
    const hits = new Map<number, SoundCue>();
    let accents = 0;
    for (let i = Math.max(0, from - game.eventOffset); i < game.events.length; i++) {
      const event = game.events[i];
      if (event.kind === 'hit') {
        const point = event.data as Point & { id: number; crit?: boolean };
        const cue = { kind: 'hit', space: soundSpace(point, listener) };
        hits.set(point.id, cue);
        cues.push(cue);
        // A critical hit adds one hard stroke; a few per batch keep them as accents.
        if (point.crit && accents++ < 2) cues.push({ kind: 'crit', space: cue.space });
      } else if (event.kind === 'thunder') cues.push({ kind: 'thunder' });
      else if (event.kind === 'build')
        cues.push({ kind: 'build', variant: (event.data as { step: number }).step - 1 });
      else if (
        event.kind === 'cards' &&
        (event.data as { cards: { rarity: string }[] }).cards.some((c) => c.rarity !== 'common')
      )
        cues.push({ kind: 'rare' });
      else if (event.kind === 'kill') {
        // The killing hit becomes its style's keystroke on the particle's keycaps,
        // sounding when the particle pops.
        const kill = event.data as {
          id: number;
          kind?: string;
          delay?: number;
          style?: PopStyle;
          particle?: ParticleKind;
        };
        const cue = hits.get(kill.id);
        if (cue) {
          // Giant particles and the Higgs particle go down like a big enter key.
          cue.kind =
            kill.kind === 'boss'
              ? 'enter'
              : ((kill.particle && particleCues[kill.particle]) ?? popCues[kill.style ?? 'tap']);
          if (kill.delay) cue.delay = kill.delay;
          if (kill.particle) cue.voice = particleIds.indexOf(kill.particle);
        }
      } else if (eventCues[event.kind]) cues.push({ kind: eventCues[event.kind] });
    }
    this.mixer.playBatch(cues, ctx.currentTime);
  }

  // Transitions stop whatever is still ringing and may open with their own sound.
  private enter(stage: string, sound: string): void {
    if (this.stage === stage) return;
    this.stage = stage;
    this.mixer?.stop();
    if (sound) this.play(sound);
  }

  play(kind: string, space?: SoundSpace): void {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    this.mixer ??= new SoundMixer(ctx);
    this.mixer.play(kind, ctx.currentTime, space);
  }
}
