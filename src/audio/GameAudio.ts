import type { Game } from '../game/Game.ts';
import { CENTER, distance } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import { particleIds } from '../game/particles.ts';
import type { ParticleKind } from '../game/particles.ts';
import type { PopStyle } from '../game/rules.ts';
import { beyondFrame, endingFrame } from '../render/timeline.ts';
import type { SoundCue, SoundSpace } from './SoundComposer.ts';
import { SoundMixer } from './SoundMixer.ts';

const space = (point: Point, listener: Point): SoundSpace => ({
  pan: (point.x - CENTER.x) / 520,
  depth: Math.min(1, distance(point, listener) / 300),
});

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

type Hit = Point & { id: number; crit?: boolean };
type Kill = {
  id: number;
  kind?: string;
  delay?: number;
  style?: PopStyle;
  particle?: ParticleKind;
};

// Turns logged game events into sound. Only real hits sound; the kill reshapes its hit.
export class GameAudio {
  private context: AudioContext | null = null;
  private mixer: SoundMixer | null = null;
  private model: Game | null = null;
  private stage = '';
  private request = 0;
  enabled = false;

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
      const stage = crossing.stage,
        voiced = stage === 'contract' || stage === 'open';
      return this.enter('beyond-' + stage, voiced ? 'beyond-' + stage : '');
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
      const { kind, data } = game.events[i];
      if (kind === 'hit') {
        const hit = data as Hit,
          cue: SoundCue = { kind: 'hit', space: space(hit, listener) };
        hits.set(hit.id, cue);
        cues.push(cue);
        // A critical hit adds one hard stroke; a few per batch keep them as accents.
        if (hit.crit && accents++ < 2) cues.push({ kind: 'crit', space: cue.space });
      } else if (kind === 'kill') {
        // The killing hit becomes its style's keystroke, sounding when the particle pops.
        const kill = data as Kill,
          cue = hits.get(kill.id);
        if (!cue) continue;
        cue.kind =
          kill.kind === 'boss'
            ? 'enter'
            : ((kill.particle && particleCues[kill.particle]) ?? popCues[kill.style ?? 'tap']);
        if (kill.delay) cue.delay = kill.delay;
        if (kill.particle) cue.voice = particleIds.indexOf(kill.particle);
      } else if (kind === 'thunder') cues.push({ kind: 'thunder' });
      else if (kind === 'build') cues.push({ kind: 'build', variant: (data.step as number) - 1 });
      else if (
        kind === 'cards' &&
        (data.cards as { rarity: string }[]).some((c) => c.rarity !== 'common')
      )
        cues.push({ kind: 'rare' });
      else if (eventCues[kind]) cues.push({ kind: eventCues[kind] });
    }
    mixer.playBatch(cues, ctx.currentTime);
  }

  // Transitions stop whatever is still ringing and may open with their own sound.
  private enter(stage: string, sound: string): void {
    if (this.stage === stage) return;
    this.stage = stage;
    this.mixer?.stop();
    if (sound) this.play(sound);
  }

  play(kind: string): void {
    const ctx = this.context;
    if (this.enabled && ctx && ctx.state === 'running') this.mixer?.play(kind, ctx.currentTime);
  }
}
