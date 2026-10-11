import { soundDefinitions, renderSound } from './samples.ts';
import type { SoundBus, SoundKind } from './samples.ts';

export type SoundSpace = { pan: number; depth: number };
export type SoundCue = { kind: string; space?: SoundSpace };

export const distanceCutoff = (depth: number) => 8000 - 4400 * depth;

type SoundBatch = {
  count: number;
  buffers: Map<SoundBus, AudioBuffer>;
  attacks: number[];
};

export class SoundComposer {
  private context: BaseAudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private filtered = new Map<string, Float32Array>();
  private variants: Partial<Record<SoundKind, number>> = {};
  private seed: number;
  private hitPool: number[] = [];
  private recentHits: number[] = [];

  constructor(context: BaseAudioContext, seed: number) {
    this.context = context;
    this.seed = seed >>> 0 || 0x9e3779b9;
    for (const kind of ['preview', 'hit'] as const)
      for (let i = 0; i < soundDefinitions[kind].variants; i++) this.buffer(kind, i);
  }

  sample(kind: SoundKind): AudioBuffer {
    const variant = kind === 'hit' ? this.nextHit() : (this.variants[kind] ?? 0);
    if (kind !== 'hit') this.variants[kind] = (variant + 1) % soundDefinitions[kind].variants;
    return this.buffer(kind, variant);
  }

  // Assemble single downstrokes inside a short window. Dense contacts share
  // cached layers, but every hit contributes; no recorded phrase or delayed queue.
  compose(cues: readonly SoundCue[]): SoundBatch {
    if (!cues.length) return { count: 0, buffers: new Map(), attacks: [] };
    const hits = cues.reduce((n, cue) => n + Number(cue.kind === 'hit'), 0);
    const offsets = [0];
    while (offsets.length < hits) {
      const next = offsets.at(-1)! + 0.018 + this.random() * 0.014;
      if (next > 0.07) break;
      offsets.push(next);
    }
    const counts = offsets.map(() => 0);
    const positions = new Uint8Array(hits);
    for (let i = 0; i < hits; i++) {
      const slot = i < offsets.length ? i : Math.floor(this.random() * offsets.length);
      const micro = i < offsets.length ? 0 : 1 + Math.floor(this.random() * 2);
      counts[slot]++;
      positions[i] = slot * 3 + micro;
    }
    const variants = new Int8Array(offsets.length * 3).fill(-1);
    const delays = Array.from({ length: variants.length }, (_, i) =>
      Math.round((offsets[Math.floor(i / 3)] + (i % 3) * 0.002) * this.context.sampleRate),
    );
    const levels = counts.map((count) => 1 + 0.32 * Math.log2(Math.max(1, count)));
    const leads = counts.map((count, i) => levels[i] * (count === 1 ? 1 : 0.65));
    const support = counts.map((count, i) => (count > 1 ? (levels[i] * 0.35) / (count - 1) : 0));
    const layers = new Map<
      string | number,
      {
        bus: SoundBus;
        samples: Float32Array;
        offset: number;
        left: number;
        right: number;
      }
    >();
    let accepted = 0;
    let hitIndex = 0;
    for (const { kind, space } of cues) {
      if (!Object.hasOwn(soundDefinitions, kind)) continue;
      const id = kind as SoundKind,
        spec = soundDefinitions[id];
      let variant = this.variants[id] ?? 0,
        offset = 0,
        weight = 1;
      if (id === 'hit') {
        const position = positions[hitIndex],
          slot = Math.floor(position / 3);
        if (variants[position] < 0) variants[position] = this.nextHit();
        variant = variants[position];
        offset = delays[position];
        weight = hitIndex++ < offsets.length ? leads[slot] : support[slot];
      }
      if (id !== 'hit') this.variants[id] = (variant + 1) % spec.variants;
      const important = spec.bus === 'rhythm' || spec.bus === 'transition';
      const depth = important ? 0 : Math.max(0, Math.min(1, space?.depth ?? 0));
      const angle =
        (((important ? 0 : Math.max(-0.35, Math.min(0.35, space?.pan ?? 0))) + 1) * Math.PI) / 4;
      const level = spec.gain * (1 - depth * 0.3) * weight;
      const left = level * Math.cos(angle),
        right = level * Math.sin(angle);
      const near = Math.floor(depth * 8),
        blend = depth * 8 - near;
      for (let i = 0; i < 2; i++) {
        const step = near + i,
          weight = i ? blend : 1 - blend;
        if (!weight) continue;
        const key =
          id === 'hit'
            ? (offset * soundDefinitions.hit.variants + variant) * 9 + step
            : id + ':' + variant + ':' + step;
        let layer = layers.get(key);
        if (!layer) {
          layer = {
            bus: spec.bus,
            samples: this.distanceBuffer(id, variant, step),
            offset,
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
    const lengths = new Map<SoundBus, number>();
    for (const layer of layers.values()) {
      const length = layer.samples.length + layer.offset;
      lengths.set(layer.bus, Math.max(lengths.get(layer.bus) ?? 0, length));
    }
    const buses = new Map<SoundBus, AudioBuffer>();
    for (const [bus, length] of lengths)
      buses.set(bus, this.context.createBuffer(2, length, this.context.sampleRate));
    for (const { bus, samples, offset, left, right } of layers.values()) {
      const buffer = buses.get(bus)!;
      const l = buffer.getChannelData(0),
        r = buffer.getChannelData(1);
      for (let i = 0; i < samples.length; i++) {
        l[i + offset] += samples[i] * left;
        r[i + offset] += samples[i] * right;
      }
    }
    return { count: accepted, buffers: buses, attacks: offsets };
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

  private random(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }

  private nextHit(): number {
    if (!this.hitPool.length) {
      this.hitPool = Array.from({ length: soundDefinitions.hit.variants }, (_, i) => i);
      for (let i = this.hitPool.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.hitPool[i], this.hitPool[j]] = [this.hitPool[j], this.hitPool[i]];
      }
    }
    let index = this.hitPool.length - 1;
    while (index > 0 && this.recentHits.includes(this.hitPool[index])) index--;
    const variant = this.hitPool.splice(index, 1)[0];
    this.recentHits.push(variant);
    if (this.recentHits.length > 4) this.recentHits.shift();
    return variant;
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

  clear(): void {
    this.buffers.clear();
    this.filtered.clear();
  }
}
