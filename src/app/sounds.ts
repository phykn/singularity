import { soundDefinitions, renderSound } from './soundBank.ts';
import type { SoundBus, SoundKind } from './soundBank.ts';

export type SoundSpace = { pan: number; depth: number };
export type SoundCue = { kind: string; space?: SoundSpace };

const distanceCutoff = (depth: number) => 8000 - 4400 * depth;

type Voice = {
  bus: SoundBus;
  end: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan?: StereoPannerNode;
  tone?: BiquadFilterNode;
  level: number;
};

export class SoundMixer {
  private voices = new Set<Voice>();
  private buffers = new Map<string, AudioBuffer>();
  private filtered = new Map<string, Float32Array>();
  private variants: Partial<Record<SoundKind, number>> = {};
  private rhythmUntil = 0;
  private filter: BiquadFilterNode;
  private compressor: DynamicsCompressorNode;
  private saturation: WaveShaperNode;
  private master: GainNode;
  private context: BaseAudioContext;
  constructor(context: BaseAudioContext) {
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
    for (const kind of ['hit', 'kill', 'dense'] as const)
      for (let i = 0; i < soundDefinitions[kind].variants; i++) this.buffer(kind, i);
  }

  private buffer(kind: SoundKind, variant: number): AudioBuffer {
    const key = kind + ':' + variant;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const data = renderSound(kind, this.context.sampleRate, variant);
      buffer = this.context.createBuffer(1, data.length, this.context.sampleRate);
      buffer.getChannelData(0).set(data);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  play(kind: string, at = this.context.currentTime, pitch = 1, space?: SoundSpace): boolean {
    if (!Object.hasOwn(soundDefinitions, kind)) return false;
    const id = kind as SoundKind,
      spec = soundDefinitions[id],
      bus = spec.bus;
    const important = bus === 'rhythm' || bus === 'transition';
    const variant = this.variants[id] ?? 0;
    this.variants[id] = (variant + 1) % spec.variants;
    const ctx = this.context,
      source = ctx.createBufferSource(),
      gain = ctx.createGain();
    const pan = ctx.createStereoPanner(),
      tone = ctx.createBiquadFilter(),
      rate = Math.max(0.85, Math.min(1.15, pitch)),
      depth = important ? 0 : Math.max(0, Math.min(1, space?.depth ?? 0));
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    tone.frequency.setValueAtTime(distanceCutoff(depth), at);
    source.buffer = this.buffer(id, variant);
    source.playbackRate.setValueAtTime(rate, at);
    const end = at + source.buffer.duration / rate;
    const foreground = this.rhythmUntil > at;
    const level = spec.gain * (1 - depth * 0.3) * (!important && foreground ? 0.8 : 1);
    gain.gain.setValueAtTime(level, at);
    if (bus === 'rhythm') this.emphasize(at, end);
    pan.pan.setValueAtTime(important ? 0 : Math.max(-0.35, Math.min(0.35, space?.pan ?? 0)), at);
    source.connect(gain).connect(tone).connect(pan).connect(this.filter);
    const voice = { bus, end, source, gain, pan, tone, level };
    this.voices.add(voice);
    source.onended = () => this.release(voice);
    source.start(at);
    source.stop(end);
    return true;
  }

  // Cues from one game frame share a start time. Sum every contribution before
  // playback instead of building a filter/panner/source graph for every hit.
  playBatch(cues: readonly SoundCue[], at = this.context.currentTime): number {
    const layers = new Map<
      string,
      {
        bus: SoundBus;
        samples: Float32Array;
        left: number;
        right: number;
      }
    >();
    let accepted = 0;
    for (const { kind, space } of cues) {
      if (!Object.hasOwn(soundDefinitions, kind)) continue;
      const id = kind as SoundKind,
        spec = soundDefinitions[id];
      const variant = this.variants[id] ?? 0;
      this.variants[id] = (variant + 1) % spec.variants;
      const important = !['hit', 'kill', 'skill'].includes(spec.bus);
      const depth = important ? 0 : Math.max(0, Math.min(1, space?.depth ?? 0));
      const angle =
        (((important ? 0 : Math.max(-0.35, Math.min(0.35, space?.pan ?? 0))) + 1) * Math.PI) / 4;
      const level = spec.gain * (1 - depth * 0.3);
      const left = level * Math.cos(angle),
        right = level * Math.sin(angle);
      const near = Math.floor(depth * 8),
        blend = depth * 8 - near;
      for (const [step, weight] of [
        [near, 1 - blend],
        [Math.min(8, near + 1), blend],
      ]) {
        if (!weight) continue;
        const key = id + ':' + variant + ':' + step;
        let layer = layers.get(key);
        if (!layer) {
          layer = {
            bus: spec.bus,
            samples: this.distanceBuffer(id, variant, step),
            left: 0,
            right: 0,
          };
          layers.set(key, layer);
        }
        layer.left += weight * left;
        layer.right += weight * right;
      }
      accepted++;
    }
    const buses = new Map<SoundBus, AudioBuffer>();
    for (const layer of layers.values()) {
      const buffer = buses.get(layer.bus);
      if (!buffer || buffer.length < layer.samples.length)
        buses.set(
          layer.bus,
          this.context.createBuffer(2, layer.samples.length, this.context.sampleRate),
        );
    }
    for (const { bus, samples, left, right } of layers.values()) {
      const buffer = buses.get(bus)!;
      const l = buffer.getChannelData(0),
        r = buffer.getChannelData(1);
      for (let i = 0; i < samples.length; i++) {
        l[i] += samples[i] * left;
        r[i] += samples[i] * right;
      }
    }
    for (const [bus, buffer] of buses) {
      const ctx = this.context,
        source = ctx.createBufferSource(),
        gain = ctx.createGain();
      source.buffer = buffer;
      const end = at + buffer.duration;
      const important = !['hit', 'kill', 'skill'].includes(bus);
      gain.gain.setValueAtTime(!important && this.rhythmUntil > at ? 0.8 : 1, at);
      if (bus === 'rhythm') this.emphasize(at, end);
      source.connect(gain).connect(this.filter);
      const voice = { bus, end, source, gain, level: 1 };
      this.voices.add(voice);
      source.onended = () => this.release(voice);
      source.start(at);
      source.stop(end);
    }
    return accepted;
  }

  private distanceBuffer(kind: SoundKind, variant: number, step: number): Float32Array {
    const key = kind + ':' + variant + ':' + step;
    let filtered = this.filtered.get(key);
    if (filtered) return filtered;
    const data = this.buffer(kind, variant).getChannelData(0);
    const omega = (2 * Math.PI * distanceCutoff(step / 8)) / this.context.sampleRate;
    const cos = Math.cos(omega),
      alpha = Math.sin(omega) / (2 * 10 ** (0.5 / 20)),
      a0 = 1 + alpha;
    const b0 = (1 - cos) / (2 * a0),
      b1 = (1 - cos) / a0;
    const a1 = (-2 * cos) / a0,
      a2 = (1 - alpha) / a0;
    filtered = new Float32Array(data.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < data.length; i++) {
      const x = data[i],
        y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      filtered[i] = y;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
    }
    this.filtered.set(key, filtered);
    return filtered;
  }

  private emphasize(at: number, end: number): void {
    this.rhythmUntil = Math.max(this.rhythmUntil, end);
    for (const voice of this.voices) {
      if (voice.end <= at || !['hit', 'kill', 'skill'].includes(voice.bus)) continue;
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
    const voices = this.voices;
    this.voices = new Set();
    this.rhythmUntil = 0;
    for (const voice of voices) {
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
    this.buffers.clear();
    this.filtered.clear();
  }
}
