import { soundDefinitions, synthesizeSound } from './soundBank.ts';
import type { SoundBus, SoundKind } from './soundBank.ts';

type Voice = {
  bus: SoundBus;
  end: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  level: number;
};
const limits: Record<SoundBus, number> = {
  hit: 2,
  kill: 3,
  skill: 1,
  reward: 2,
  rhythm: 2,
  transition: 2,
};
const spacing: Record<SoundBus, number> = {
  hit: 0.065,
  kill: 1 / 12,
  skill: 0.24,
  reward: 0.12,
  rhythm: 0.055,
  transition: 0.03,
};

export class SoundMixer {
  private voices: Voice[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private variants: Partial<Record<SoundKind, number>> = {};
  private next: Partial<Record<SoundBus, number>> = {};
  private filter: BiquadFilterNode;
  private compressor: DynamicsCompressorNode;
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
    this.master = context.createGain();
    this.master.gain.value = 0.78;
    this.filter.connect(this.compressor).connect(this.master).connect(context.destination);
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

  play(kind: string, at = this.context.currentTime, pitch = 1): boolean {
    if (!Object.hasOwn(soundDefinitions, kind)) return false;
    const id = kind as SoundKind,
      spec = soundDefinitions[id],
      bus = spec.bus;
    this.voices = this.voices.filter((voice) => voice.end > at);
    const important = bus === 'rhythm' || bus === 'transition' || bus === 'reward';
    // Reserve two voices for taps and transitions, including during reward sounds.
    if (
      at + 1e-8 < (this.next[bus] ?? -Infinity) ||
      this.voices.length >= (bus === 'rhythm' || bus === 'transition' ? 8 : 6) ||
      this.voices.filter((voice) => voice.bus === bus).length >= limits[bus]
    )
      return false;
    const variant = this.variants[id] ?? 0;
    this.variants[id] = (variant + 1) % spec.variants;
    this.next[bus] = at + spacing[bus];
    const ctx = this.context,
      source = ctx.createBufferSource(),
      gain = ctx.createGain();
    const pan = ctx.createStereoPanner(),
      rate = Math.max(0.85, Math.min(1.15, pitch));
    source.buffer = this.buffer(id, variant);
    source.playbackRate.setValueAtTime(rate, at);
    const end = at + source.buffer.duration / rate;
    const crowded = this.voices.filter((voice) =>
      ['hit', 'kill', 'skill'].includes(voice.bus),
    ).length;
    const foreground = this.voices.some((voice) => voice.bus === 'rhythm');
    const level =
      (spec.gain / Math.sqrt(1 + crowded * 0.22)) * (!important && foreground ? 0.55 : 1);
    gain.gain.setValueAtTime(level, at);
    if (bus === 'rhythm') {
      for (const voice of this.voices.filter((voice) =>
        ['hit', 'kill', 'skill'].includes(voice.bus),
      )) {
        voice.gain.gain.cancelAndHoldAtTime(at);
        voice.gain.gain.setTargetAtTime(voice.level * 0.3, at, 0.006);
      }
    }
    pan.pan.setValueAtTime(important ? 0 : Math.sin(variant * 2.399 + kind.length) * 0.16, at);
    source.connect(gain).connect(pan).connect(this.filter);
    const voice = { bus, end, source, gain, pan, level };
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
    this.next = {};
  }

  dispose(): void {
    this.stop(this.context.currentTime, true);
    this.filter.disconnect();
    this.compressor.disconnect();
    this.master.disconnect();
    this.buffers.clear();
  }
}

// Fixed buckets and no catch-up queue: bursts become one texture, never late kills.
export class KillRhythm {
  private buckets = Array.from({ length: 10 }, () => ({ tick: -Infinity, count: 0 }));
  private next = 0;
  private lastKill = -Infinity;
  private pending = 0;
  private pulse = 0;
  add(count: number, time: number): void {
    if (count <= 0) return;
    if (time - this.lastKill > 0.24) this.next = time;
    const tick = Math.floor(time * 10),
      bucket = this.buckets[tick % 10];
    if (bucket.tick !== tick) {
      bucket.tick = tick;
      bucket.count = 0;
    }
    bucket.count = Math.min(200, bucket.count + count);
    this.pending = Math.min(200, this.pending + count);
    this.lastKill = time;
  }
  update(time: number): number | null {
    if (time - this.lastKill > 0.24) {
      this.pending = 0;
      return null;
    }
    if (!this.pending || time + 1e-8 < this.next) return null;
    const tick = Math.floor(time * 10);
    const rate = this.buckets.reduce((sum, b) => sum + (tick - b.tick < 10 ? b.count : 0), 0);
    this.next = time + 1 / Math.min(12, Math.max(4, rate));
    this.pending = 0;
    this.pulse++;
    return 0.98 + Math.sin(this.pulse * 2.399) * 0.025;
  }
  reset(): void {
    for (const b of this.buckets) {
      b.tick = -Infinity;
      b.count = 0;
    }
    this.next = 0;
    this.lastKill = -Infinity;
    this.pending = 0;
    this.pulse = 0;
  }
}
