import type { Game } from '../game/Game.ts';
import type { EventKind } from '../game/events.ts';
import { CENTER, distance } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import { particleIds } from '../game/rules.ts';
import type { ParticleKind, PopStyle } from '../game/rules.ts';
import { beyondFrame, endingFrame } from '../render/timeline.ts';
import type { SoundCue, SoundSpace } from './SoundComposer.ts';
import { SoundMixer } from './SoundMixer.ts';

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
const eventCues: Partial<Record<EventKind, string>> = {
  wave: 'wave',
  critical: 'wave',
  boss: 'wave',
  'final-boss': 'wave',
  charged: 'charged',
  'boss-down': 'charged',
  evolve: 'charged',
};

const space = (point: Point, listener: Point): SoundSpace => ({
  pan: (point.x - CENTER.x) / 520,
  depth: Math.min(1, distance(point, listener) / 300),
});

// Turns logged game events into sound. Only real hits sound; the kill reshapes its hit.
export class GameAudio {
  enabled = false;
  private context: AudioContext | null = null;
  private mixer: SoundMixer | null = null;
  private model: Game | null = null;
  // The transition whose sound is playing, so it starts once.
  private stage = '';
  private request = 0;

  // False when the browser refused; null when a later unlock or suspend replaced this one.
  async unlock(): Promise<boolean | null> {
    const request = ++this.request;
    try {
      const context = (this.context ??= new AudioContext());
      await context.resume();
      if (request !== this.request || this.context !== context) return null;
      this.enabled = context.state === 'running';
      if (this.enabled) this.mixer ??= new SoundMixer(context);
      return this.enabled;
    } catch {
      if (request !== this.request) return null;
      this.enabled = false;
      return false;
    }
  }

  suspend(): void {
    this.mixer?.stop(this.context?.currentTime, true);
    this.stage = '';
    this.request++;
    this.enabled = false;
    void this.context?.suspend().catch(() => {});
  }

  destroy(): void {
    this.mixer?.dispose();
    this.mixer = null;
    this.model = null;
    this.request++;
    this.enabled = false;
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  // Sounds the events logged since `from`, or the transition the run is in.
  update(game: Game, from: number): void {
    const ctx = this.context,
      mixer = this.mixer;
    if (!this.enabled || !ctx || !mixer || ctx.state !== 'running') return;
    if (this.model !== game) {
      mixer.stop();
      this.stage = '';
      this.model = game;
    }
    if (game.phase === 'ready') return;
    const crossing = beyondFrame(game);
    if (crossing) {
      const stage = 'beyond-' + crossing.stage;
      return this.enter(
        stage,
        crossing.stage === 'contract' || crossing.stage === 'open' ? stage : '',
      );
    }
    const ending = endingFrame(game);
    if (ending) {
      if (!ending.success)
        return this.enter(ending.stage, ending.stage === 'impact' ? 'collision' : '');
      const singing = game.phase === 'collapse' && !ending.quiet;
      return this.enter(singing ? 'singularity' : 'silence', singing ? 'singularity' : '');
    }
    this.stage = '';
    const cues: SoundCue[] = [],
      hits = new Map<number, SoundCue>(),
      listener = game.position;
    let accents = 0;
    for (let i = Math.max(0, from - game.eventOffset); i < game.events.length; i++) {
      const event = game.events[i];
      if (event.kind === 'hit') {
        const cue: SoundCue = { kind: 'hit', space: space(event.data, listener) };
        hits.set(event.data.id, cue);
        cues.push(cue);
        // A critical hit adds one hard stroke; a few per batch keep them as accents.
        if (event.data.crit && accents++ < 2) cues.push({ kind: 'crit', space: cue.space });
      } else if (event.kind === 'kill') {
        // The killing hit becomes its style's keystroke, sounding when the particle pops.
        const { id, kind, particle, style, delay } = event.data,
          cue = hits.get(id);
        if (!cue) continue;
        cue.kind = kind === 'boss' ? 'enter' : (particleCues[particle] ?? popCues[style]);
        if (delay) cue.delay = delay;
        cue.voice = particleIds.indexOf(particle);
      } else if (event.kind === 'thunder') cues.push({ kind: 'thunder' });
      else if (event.kind === 'build') cues.push({ kind: 'build', variant: event.data.step - 1 });
      else if (event.kind === 'cards') {
        if (event.data.cards.some((card) => card.rarity !== 'common')) cues.push({ kind: 'rare' });
      } else if (eventCues[event.kind]) cues.push({ kind: eventCues[event.kind]! });
    }
    mixer.playBatch(cues, ctx.currentTime);
  }

  play(kind: string): void {
    const ctx = this.context;
    if (this.enabled && ctx && ctx.state === 'running') this.mixer?.play(kind, ctx.currentTime);
  }

  // Transitions stop whatever is still ringing and may open with their own sound.
  private enter(stage: string, sound: string): void {
    if (this.stage === stage) return;
    this.stage = stage;
    this.mixer?.stop();
    if (sound) this.play(sound);
  }
}
