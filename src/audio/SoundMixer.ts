import { soundDefinitions } from './samples.ts';
import type { SoundBus, SoundKind } from './samples.ts';
import { SoundComposer, distanceCutoff } from './SoundComposer.ts';
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
  attacks: number[];
};

export class SoundMixer {
  private voices = new Set<Voice>();
  private composer: SoundComposer;
  private rhythmUntil = 0;
  private filter: BiquadFilterNode;
  private compressor: DynamicsCompressorNode;
  private saturation: WaveShaperNode;
  private master: GainNode;
  private context: BaseAudioContext;
  constructor(context: BaseAudioContext, seed = Math.floor(Math.random() * 4294967296)) {
    this.context = context;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 9000;
    this.filter.Q.value = 0.7;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 14;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.12;
    this.saturation = context.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1)) * 2 - 1);
    this.saturation.curve = curve;
    this.master = context.createGain();
    this.master.gain.value = 0.78;
    this.filter
      .connect(this.compressor)
      .connect(this.saturation)
      .connect(this.master)
      .connect(context.destination);
    this.composer = new SoundComposer(context, seed);
  }

  play(kind: string, at = this.context.currentTime, pitch = 1, space?: SoundSpace): boolean {
    if (!Object.hasOwn(soundDefinitions, kind)) return false;
    const id = kind as SoundKind,
      spec = soundDefinitions[id],
      bus = spec.bus;
    const important = bus === 'rhythm' || bus === 'transition';
    const ctx = this.context,
      source = ctx.createBufferSource(),
      gain = ctx.createGain();
    const pan = ctx.createStereoPanner(),
      tone = ctx.createBiquadFilter(),
      rate = Math.max(0.85, Math.min(1.15, pitch)),
      depth = important ? 0 : Math.max(0, Math.min(1, space?.depth ?? 0));
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    source.buffer = this.composer.sample(id);
    const start = Math.max(at, ctx.currentTime);
    tone.frequency.setValueAtTime(distanceCutoff(depth), start);
    source.playbackRate.setValueAtTime(rate, start);
    const end = start + source.buffer.duration / rate;
    const foreground = this.rhythmUntil > start;
    const level = spec.gain * (1 - depth * 0.3);
    gain.gain.setValueAtTime(level * (!important && foreground ? 0.8 : 1), start);
    if (bus === 'hit') this.separateHits(start);
    if (bus === 'rhythm') this.emphasize(start, end);
    pan.pan.setValueAtTime(important ? 0 : Math.max(-0.35, Math.min(0.35, space?.pan ?? 0)), start);
    source.connect(gain).connect(tone).connect(pan).connect(this.filter);
    const voice = {
      bus,
      start,
      end,
      source,
      gain,
      pan,
      tone,
      level,
      ducked: false,
      stopping: false,
      attacks: [start],
    };
    this.voices.add(voice);
    source.onended = () => this.release(voice);
    source.start(start);
    source.stop(end);
    return true;
  }

  playBatch(cues: readonly SoundCue[], at = this.context.currentTime): number {
    if (!cues.length) return 0;
    const batch = this.composer.compose(cues);
    for (const [bus, buffer] of batch.buffers) {
      const ctx = this.context,
        source = ctx.createBufferSource(),
        gain = ctx.createGain();
      source.buffer = buffer;
      const start = Math.max(at, ctx.currentTime),
        end = start + buffer.duration;
      const important = bus === 'rhythm' || bus === 'transition';
      gain.gain.setValueAtTime(!important && this.rhythmUntil > start ? 0.8 : 1, start);
      if (bus === 'hit') this.separateHits(start);
      if (bus === 'rhythm') this.emphasize(start, end);
      source.connect(gain).connect(this.filter);
      const voice = {
        bus,
        start,
        end,
        source,
        gain,
        level: 1,
        ducked: false,
        stopping: false,
        attacks: bus === 'hit' ? batch.attacks.map((offset) => start + offset) : [],
      };
      this.voices.add(voice);
      source.onended = () => this.release(voice);
      source.start(start);
      source.stop(end);
    }
    return batch.count;
  }

  private separateHits(at: number): void {
    for (const voice of this.voices) {
      if (
        voice.stopping ||
        voice.bus !== 'hit' ||
        voice.ducked ||
        voice.start >= at ||
        voice.end <= at
      )
        continue;
      voice.ducked = true;
      this.hitGain(voice, at, voice.level * (this.rhythmUntil > at ? 0.8 : 1));
    }
  }

  private hitGain(voice: Voice, at: number, level: number): void {
    const gain = voice.gain.gain;
    gain.cancelAndHoldAtTime(at);
    if (!voice.ducked) {
      gain.setTargetAtTime(level, at, 0.003);
      return;
    }
    let tailAt = at;
    for (const attack of voice.attacks)
      if (attack <= at && attack + 0.014 > at) tailAt = Math.max(tailAt, attack + 0.014);
    gain.setTargetAtTime(level * 0.4, tailAt, 0.003);
    for (const attack of voice.attacks) {
      if (attack <= at) continue;
      gain.setTargetAtTime(level, attack, 0.0008);
      gain.setTargetAtTime(level * 0.4, attack + 0.014, 0.003);
    }
  }

  private emphasize(at: number, end: number): void {
    this.rhythmUntil = Math.max(this.rhythmUntil, end);
    for (const voice of this.voices) {
      if (voice.stopping || voice.end <= at || !['preview', 'hit'].includes(voice.bus)) continue;
      if (voice.bus === 'hit') {
        this.hitGain(voice, at, voice.level * 0.8);
        continue;
      }
      voice.gain.gain.cancelAndHoldAtTime(at);
      voice.gain.gain.setTargetAtTime(voice.level * 0.8, at, 0.006);
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
    this.filter.disconnect();
    this.compressor.disconnect();
    this.saturation.disconnect();
    this.master.disconnect();
    this.composer.clear();
  }
}
