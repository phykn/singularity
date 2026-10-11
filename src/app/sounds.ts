import { soundDefinitions, synthesizeSound } from './soundBank.ts';
import type { SoundBus, SoundKind } from './soundBank.ts';

export type SoundSpace = { pan: number; depth: number };

type Voice = {
  bus: SoundBus;
  end: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  tone: BiquadFilterNode;
  level: number;
};

export class SoundMixer {
  private voices: Voice[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private variants: Partial<Record<SoundKind, number>> = {};
  private filter: BiquadFilterNode;
  private compressor: DynamicsCompressorNode;
  private saturation: WaveShaperNode;
  private master: GainNode;
  private context: BaseAudioContext;
  constructor(context: BaseAudioContext) {
    this.context = context;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 6200;
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
      const data = synthesizeSound(kind, this.context.sampleRate, variant);
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
    this.voices = this.voices.filter((voice) => voice.end > at);
    const important = bus === 'rhythm' || bus === 'transition' || bus === 'reward';
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
    tone.frequency.setValueAtTime(5200 * (1 - depth) + 1400 * depth, at);
    source.buffer = this.buffer(id, variant);
    source.playbackRate.setValueAtTime(rate, at);
    const end = at + source.buffer.duration / rate;
    const foreground = this.voices.some((voice) => voice.bus === 'rhythm');
    const level = spec.gain * (1 - depth * 0.3) * (!important && foreground ? 0.8 : 1);
    gain.gain.setValueAtTime(level, at);
    if (bus === 'rhythm') {
      for (const voice of this.voices.filter((voice) =>
        ['hit', 'kill', 'skill'].includes(voice.bus),
      )) {
        voice.gain.gain.cancelAndHoldAtTime(at);
        voice.gain.gain.setTargetAtTime(voice.level * 0.8, at, 0.006);
      }
    }
    pan.pan.setValueAtTime(important ? 0 : Math.max(-0.35, Math.min(0.35, space?.pan ?? 0)), at);
    source.connect(gain).connect(tone).connect(pan).connect(this.filter);
    const voice = { bus, end, source, gain, pan, tone, level };
    this.voices.push(voice);
    source.onended = () => this.release(voice);
    source.start(at);
    source.stop(end);
    return true;
  }

  private release(voice: Voice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.pan.disconnect();
    voice.tone.disconnect();
    const index = this.voices.indexOf(voice);
    if (index >= 0) this.voices.splice(index, 1);
  }

  stop(at = this.context.currentTime, immediate = false): void {
    const voices = this.voices;
    this.voices = [];
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
  }
}
