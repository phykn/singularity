import { contactSounds, renderSound, soundDefinitions } from './samples.ts';
import type { SoundBus, SoundKind } from './samples.ts';

export type SoundSpace = { pan: number; depth: number };
export type SoundCue = {
  kind: string;
  space?: SoundSpace;
  // Seconds a kill waits for its pop.
  delay?: number;
  // The particle voice: its keycaps and tone.
  voice?: number;
  // A fixed variant, such as how far a charge has built.
  variant?: number;
};
type Layer = { bus: SoundBus; samples: Float32Array; offset: number; left: number; right: number };

// Rhythm and transition sounds play up front: centred, close, never ducked under the rhythm.
export const upfront = (bus: SoundBus) => bus === 'rhythm' || bus === 'transition';
export function placement(bus: SoundBus, space?: SoundSpace): SoundSpace {
  if (upfront(bus)) return { pan: 0, depth: 0 };
  return {
    pan: Math.max(-0.35, Math.min(0.35, space?.pan ?? 0)),
    depth: Math.max(0, Math.min(1, space?.depth ?? 0)),
  };
}
// Farther sounds are duller.
export const distanceCutoff = (depth: number) => 8000 - 4400 * depth;

// Six particle voices: each owns a few keycaps and sits at its own pitch.
const voiceTones = [1.08, 1.16, 1, 0.84, 1.26, 0.93],
  // Distance filters are cached in this many steps and blended between.
  depthSteps = 8,
  // Strokes of one slot sit this many 2 ms steps apart.
  micros = 3;

// Renders and caches samples, and assembles a batch of cues into one buffer per bus.
export class SoundComposer {
  private readonly context: BaseAudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private filtered = new Map<string, Float32Array>();
  // The next variant of each sound that cycles through its variants.
  private variants: Partial<Record<SoundKind, number>> = {};
  private seed: number;
  private hitPool: number[] = [];
  private recentHits: number[] = [];
  private voiceTurns = voiceTones.map(() => 0);

  constructor(context: BaseAudioContext, seed: number) {
    this.context = context;
    this.seed = seed >>> 0 || 0x9e3779b9;
    // The first sounds of a run are ready before they are needed.
    for (const kind of ['preview', 'hit', 'pop'] as const)
      for (let i = 0; i < soundDefinitions[kind].variants; i++) this.buffer(kind, i);
  }

  sample(kind: SoundKind): AudioBuffer {
    if (kind === 'hit') return this.buffer(kind, this.nextHit());
    const variant = this.variants[kind] ?? 0;
    this.variants[kind] = (variant + 1) % soundDefinitions[kind].variants;
    return this.buffer(kind, variant);
  }

  // Contacts become single downstrokes strummed inside a short window. Dense contacts share
  // cached layers, but every hit contributes. `attacks` are the strum's strokes, in seconds.
  compose(cues: readonly SoundCue[]) {
    const rate = this.context.sampleRate,
      hits = cues.filter((cue) => contactSounds.has(cue.kind)).length,
      strum = this.strum(hits),
      // The keycap of each stroke, drawn when its first hit arrives.
      keycaps = new Int8Array(strum.offsets.length * micros).fill(-1),
      layers = new Map<string | number, Layer>();
    let count = 0,
      hit = 0;
    for (const cue of cues) {
      if (!Object.hasOwn(soundDefinitions, cue.kind)) continue;
      const id = cue.kind as SoundKind,
        spec = soundDefinitions[id],
        contact = contactSounds.has(id);
      let variant = this.variants[id] ?? 0,
        offset = 0,
        weight = 1,
        tone = 1;
      if (contact) {
        const stroke = strum.strokes[hit],
          slot = Math.floor(stroke / micros);
        if (keycaps[stroke] < 0) keycaps[stroke] = this.nextHit();
        variant = keycaps[stroke];
        offset = Math.round((strum.offsets[slot] + (stroke % micros) * 0.002) * rate);
        weight = hit++ < strum.offsets.length ? strum.leads[slot] : strum.support[slot];
      }
      if (cue.voice !== undefined && id !== 'hit') {
        // Each particle voice cycles through its own keycaps.
        const keys = Array.from({ length: spec.variants }, (_, i) => i).filter(
          (i) => i % voiceTones.length === cue.voice,
        );
        variant = keys[this.voiceTurns[cue.voice]++ % keys.length];
        tone = voiceTones[cue.voice];
      }
      if (cue.delay) offset += Math.round(cue.delay * rate);
      if (cue.variant !== undefined) variant = cue.variant;
      else if (!contact) this.variants[id] = (variant + 1) % spec.variants;
      const { pan, depth } = placement(spec.bus, cue.space),
        angle = ((pan + 1) * Math.PI) / 4,
        level = spec.gain * (1 - depth * 0.3) * weight,
        left = level * Math.cos(angle),
        right = level * Math.sin(angle),
        near = Math.floor(depth * depthSteps),
        blend = depth * depthSteps - near;
      for (const [step, share] of [
        [near, 1 - blend],
        [near + 1, blend],
      ]) {
        if (!share) continue;
        const key =
          id === 'hit'
            ? (offset * spec.variants + variant) * (depthSteps + 1) + step
            : id + ':' + variant + ':' + tone + ':' + step + ':' + offset;
        let layer = layers.get(key);
        if (!layer) {
          const samples = this.distanceBuffer(id, variant, step, tone);
          layers.set(key, (layer = { bus: spec.bus, samples, offset, left: 0, right: 0 }));
        }
        layer.left += share * left;
        layer.right += share * right;
      }
      count++;
    }
    return { count, buffers: this.mix([...layers.values()]), attacks: strum.offsets };
  }

  clear(): void {
    this.buffers.clear();
    this.filtered.clear();
  }

  // Where `hits` contacts fall: up to four slots 18 to 32 ms apart, the first hits leading
  // one slot each and the rest joining a slot a step or two later. A crowded slot grows
  // louder by the logarithm of its count, most of it on the lead.
  private strum(hits: number) {
    const offsets = [0];
    while (offsets.length < hits) {
      const next = offsets.at(-1)! + 0.018 + this.random() * 0.014;
      if (next > 0.07) break;
      offsets.push(next);
    }
    const counts = offsets.map(() => 0),
      strokes = new Uint8Array(hits);
    for (let i = 0; i < hits; i++) {
      const lead = i < offsets.length,
        slot = lead ? i : Math.floor(this.random() * offsets.length),
        micro = lead ? 0 : 1 + Math.floor(this.random() * 2);
      counts[slot]++;
      strokes[i] = slot * micros + micro;
    }
    const levels = counts.map((n) => 1 + 0.32 * Math.log2(Math.max(1, n)));
    return {
      offsets,
      strokes,
      leads: counts.map((n, i) => levels[i] * (n === 1 ? 1 : 0.65)),
      support: counts.map((n, i) => (n > 1 ? (levels[i] * 0.35) / (n - 1) : 0)),
    };
  }

  private mix(layers: Layer[]): Map<SoundBus, AudioBuffer> {
    const lengths = new Map<SoundBus, number>(),
      buffers = new Map<SoundBus, AudioBuffer>();
    for (const { bus, samples, offset } of layers)
      lengths.set(bus, Math.max(lengths.get(bus) ?? 0, samples.length + offset));
    for (const [bus, length] of lengths)
      buffers.set(bus, this.context.createBuffer(2, length, this.context.sampleRate));
    for (const { bus, samples, offset, left, right } of layers) {
      const buffer = buffers.get(bus)!,
        l = buffer.getChannelData(0),
        r = buffer.getChannelData(1);
      for (let i = 0; i < samples.length; i++) {
        l[i + offset] += samples[i] * left;
        r[i + offset] += samples[i] * right;
      }
    }
    return buffers;
  }

  private buffer(kind: SoundKind, variant: number, tone = 1): AudioBuffer {
    const key = kind + ':' + variant + (tone === 1 ? '' : ':' + tone);
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const data = renderSound(kind, this.context.sampleRate, variant, tone);
      buffer = this.context.createBuffer(1, data.length, this.context.sampleRate);
      buffer.getChannelData(0).set(data);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  // A sample through a low-pass at `step` of the distance steps.
  private distanceBuffer(kind: SoundKind, variant: number, step: number, tone: number) {
    const key = kind + ':' + variant + ':' + tone + ':' + step;
    let filtered = this.filtered.get(key);
    if (filtered) return filtered;
    const data = this.buffer(kind, variant, tone).getChannelData(0),
      omega = (2 * Math.PI * distanceCutoff(step / depthSteps)) / this.context.sampleRate,
      cos = Math.cos(omega),
      alpha = Math.sin(omega) / (2 * 10 ** (0.5 / 20)),
      a0 = 1 + alpha,
      b0 = (1 - cos) / (2 * a0),
      b1 = (1 - cos) / a0,
      a1 = (-2 * cos) / a0,
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

  private random(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }

  // A shuffled pass through every keycap, skipping the last few heard.
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
}
