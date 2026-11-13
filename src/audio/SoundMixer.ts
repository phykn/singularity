import { soundDefinitions } from './samples.ts';
import type { SoundBus, SoundKind } from './samples.ts';
import { SoundComposer, distanceCutoff, placement, upfront } from './SoundComposer.ts';
import type { SoundCue, SoundSpace } from './SoundComposer.ts';

type Voice = {
  bus: SoundBus;
  start: number;
  end: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan?: StereoPannerNode;
  tone?: BiquadFilterNode;
  level: number;
  ducked: boolean;
  stopping: boolean;
  // When the strokes inside the buffer land.
  attacks: number[];
};

// A stroke keeps its full level this long before an older batch's tail drops under a newer one.
const strokeSeconds = 0.014,
  // Everything but the up-front buses steps back while a rhythm sound rings.
  underRhythm = 0.8;

// Plays buffers through one shared chain (low-pass, compressor, saturation, master) and
// keeps overlapping batches apart: a new batch of hits ducks the tails of older ones.
export class SoundMixer {
  private readonly context: BaseAudioContext;
  private readonly composer: SoundComposer;
  private readonly chain: AudioNode[];
  private voices = new Set<Voice>();
  private rhythmUntil = 0;

  constructor(context: BaseAudioContext, seed = Math.floor(Math.random() * 4294967296)) {
    this.context = context;
    const filter = context.createBiquadFilter(),
      compressor = context.createDynamicsCompressor(),
      saturation = context.createWaveShaper(),
      master = context.createGain(),
      curve = new Float32Array(4097);
    filter.type = 'lowpass';
    filter.frequency.value = 9000;
    filter.Q.value = 0.7;
    compressor.threshold.value = -18;
    compressor.knee.value = 14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1)) * 2 - 1);
    saturation.curve = curve;
    master.gain.value = 0.78;
    filter.connect(compressor).connect(saturation).connect(master).connect(context.destination);
    this.chain = [filter, compressor, saturation, master];
    this.composer = new SoundComposer(context, seed);
  }

  // One sound with its own distance filter and pan; false for an unknown kind.
  play(kind: string, at = this.context.currentTime, space?: SoundSpace): boolean {
    if (!Object.hasOwn(soundDefinitions, kind)) return false;
    const spec = soundDefinitions[kind as SoundKind],
      ctx = this.context,
      // Rendering a sample the first time takes a moment; start after it.
      buffer = this.composer.sample(kind as SoundKind),
      start = Math.max(at, ctx.currentTime),
      { pan, depth } = placement(spec.bus, space),
      panner = ctx.createStereoPanner(),
      tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    tone.frequency.setValueAtTime(distanceCutoff(depth), start);
    panner.pan.setValueAtTime(pan, start);
    this.launch(spec.bus, buffer, start, spec.gain * (1 - depth * 0.3), [0], {
      pan: panner,
      tone,
    });
    return true;
  }

  // A batch arrives already mixed and placed, one buffer per bus; returns the cues it took.
  playBatch(cues: readonly SoundCue[], at = this.context.currentTime): number {
    if (!cues.length) return 0;
    const batch = this.composer.compose(cues),
      start = Math.max(at, this.context.currentTime);
    for (const [bus, buffer] of batch.buffers)
      this.launch(bus, buffer, start, 1, bus === 'hit' ? batch.attacks : []);
    return batch.count;
  }

  stop(at = this.context.currentTime, immediate = false): void {
    this.rhythmUntil = 0;
    for (const voice of this.voices) {
      if (voice.stopping && !immediate) continue;
      voice.stopping = true;
      voice.gain.gain.cancelAndHoldAtTime(at);
      voice.gain.gain.setTargetAtTime(0, at, 0.002);
      voice.source.stop(Math.min(voice.end, at + (immediate ? 0 : 0.008)));
      if (immediate) this.release(voice);
    }
  }

  dispose(): void {
    this.stop(this.context.currentTime, true);
    for (const node of this.chain) node.disconnect();
    this.composer.clear();
  }

  // `attacks` are the strokes inside the buffer, as offsets from its start.
  private launch(
    bus: SoundBus,
    buffer: AudioBuffer,
    start: number,
    level: number,
    attacks: readonly number[],
    nodes?: { pan: StereoPannerNode; tone: BiquadFilterNode },
  ): void {
    const source = this.context.createBufferSource(),
      gain = this.context.createGain(),
      end = start + buffer.duration;
    source.buffer = buffer;
    gain.gain.setValueAtTime(
      level * (!upfront(bus) && this.rhythmUntil > start ? underRhythm : 1),
      start,
    );
    if (bus === 'hit') this.separateHits(start);
    if (bus === 'rhythm') this.emphasize(start, end);
    source.connect(gain);
    if (nodes) gain.connect(nodes.tone).connect(nodes.pan).connect(this.chain[0]);
    else gain.connect(this.chain[0]);
    const voice: Voice = {
      bus,
      start,
      end,
      source,
      gain,
      ...nodes,
      level,
      ducked: false,
      stopping: false,
      attacks: attacks.map((offset) => start + offset),
    };
    this.voices.add(voice);
    source.onended = () => this.release(voice);
    source.start(start);
    source.stop(end);
  }

  // A new batch of hits ducks the hit batches still ringing.
  private separateHits(at: number): void {
    for (const voice of this.voices) {
      if (voice.stopping || voice.bus !== 'hit' || voice.ducked) continue;
      if (voice.start >= at || voice.end <= at) continue;
      voice.ducked = true;
      this.hitGain(voice, at, voice.level * (this.rhythmUntil > at ? underRhythm : 1));
    }
  }

  // A ducked batch keeps each of its strokes at `level` and drops to 40% between them.
  private hitGain(voice: Voice, at: number, level: number): void {
    const gain = voice.gain.gain;
    gain.cancelAndHoldAtTime(at);
    if (!voice.ducked) {
      gain.setTargetAtTime(level, at, 0.003);
      return;
    }
    let tailAt = at;
    for (const attack of voice.attacks)
      if (attack <= at && attack + strokeSeconds > at)
        tailAt = Math.max(tailAt, attack + strokeSeconds);
    gain.setTargetAtTime(level * 0.4, tailAt, 0.003);
    for (const attack of voice.attacks) {
      if (attack <= at) continue;
      gain.setTargetAtTime(level, attack, 0.0008);
      gain.setTargetAtTime(level * 0.4, attack + strokeSeconds, 0.003);
    }
  }

  // A rhythm sound pushes hits and previews back until it ends.
  private emphasize(at: number, end: number): void {
    this.rhythmUntil = Math.max(this.rhythmUntil, end);
    for (const voice of this.voices) {
      if (voice.stopping || voice.end <= at) continue;
      if (voice.bus === 'hit') this.hitGain(voice, at, voice.level * underRhythm);
      else if (voice.bus === 'preview') {
        voice.gain.gain.cancelAndHoldAtTime(at);
        voice.gain.gain.setTargetAtTime(voice.level * underRhythm, at, 0.006);
      }
    }
  }

  private release(voice: Voice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.pan?.disconnect();
    voice.tone?.disconnect();
    this.voices.delete(voice);
  }
}
