import bank from './keycaps.json' with { type: 'json' };
import { rules } from '../game/rules.ts';

type Bus = 'preview' | 'hit' | 'rhythm' | 'transition';
type Recipe = 'key' | 'impact' | 'pair' | 'inhale' | 'exhale';
type Definition = {
  bus: Bus;
  recipe: Recipe;
  duration: number;
  gain: number;
  color: number;
  variants: number;
};

export const soundDefinitions = {
  preview: { bus: 'preview', recipe: 'key', duration: 0.12, gain: 0.3, color: 1, variants: 8 },
  hit: {
    bus: 'hit',
    recipe: 'impact',
    duration: 0.065,
    gain: 0.32,
    color: 1.05,
    variants: bank.keys.length,
  },
  wave: {
    bus: 'transition',
    recipe: 'pair',
    duration: 0.4,
    gain: 0.24,
    color: 0.94,
    variants: 2,
  },
  charged: {
    bus: 'transition',
    recipe: 'inhale',
    duration: 0.72,
    gain: 0.24,
    color: 0.9,
    variants: 1,
  },
  collision: {
    bus: 'transition',
    recipe: 'impact',
    duration: 0.12,
    gain: 0.34,
    color: 0.94,
    variants: 1,
  },
  singularity: {
    bus: 'transition',
    recipe: 'inhale',
    duration: rules.collisionSeconds - 0.15,
    gain: 0.46,
    color: 1,
    variants: 1,
  },
  'beyond-contract': {
    bus: 'transition',
    recipe: 'inhale',
    duration: 0.55,
    gain: 0.25,
    color: 0.94,
    variants: 1,
  },
  'beyond-open': {
    bus: 'transition',
    recipe: 'exhale',
    duration: 0.55,
    gain: 0.35,
    color: 0.85,
    variants: 1,
  },
  'rhythm-complete': {
    bus: 'rhythm',
    recipe: 'impact',
    duration: 0.09,
    gain: 0.47,
    color: 0.95,
    variants: 4,
  },
} satisfies Record<string, Definition>;

export type SoundKind = keyof typeof soundDefinitions;
export type SoundBus = Bus;

const recordings = new Map<number, { press: Float32Array; release: Float32Array }>();
function decode(encoded: string) {
  const raw = atob(encoded),
    samples = new Float32Array(raw.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const value = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    samples[i] = ((value << 16) >> 16) / 32768;
  }
  return samples;
}
function recording(index: number) {
  let key = recordings.get(index);
  if (!key) {
    key = { press: decode(bank.keys[index].press), release: decode(bank.keys[index].release) };
    recordings.set(index, key);
  }
  return key;
}

export function renderSound(kind: SoundKind, sampleRate: number, variant = 0): Float32Array {
  const spec = soundDefinitions[kind];
  const data = new Float32Array(Math.ceil(spec.duration * sampleRate));
  let seed = 2166136261;
  for (const char of kind) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const palette = kind === 'hit' ? bank.keys.length : soundDefinitions.preview.variants;
  const first = ((seed >>> 0) + variant * 5) % palette;
  seed ^= Math.imul(variant + 1, 0x9e3779b9);
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const color = spec.color * (0.97 + random() * 0.06);
  const add = (at: number, samples: Float32Array, amp: number, pitch: number) => {
    const start = Math.round(at * sampleRate),
      step = (bank.sampleRate * pitch) / sampleRate;
    const count = Math.min(data.length - start, Math.ceil((samples.length - 1) / step));
    for (let i = 0; i < count; i++) {
      const p = i * step,
        index = Math.floor(p),
        blend = p - index;
      data[start + i] += (samples[index] * (1 - blend) + samples[index + 1] * blend) * amp;
    }
  };
  const key = (at: number, index: number, amp: number) => {
    const source = recording(index % palette);
    const pitch = color * (0.98 + random() * 0.04);
    add(at, source.press, amp, pitch);
    add(at + 0.046 + random() * 0.006, source.release, amp * 0.28, pitch * 1.04);
  };
  const strokes = (count: number, amp: number) => {
    const span = Math.max(0, spec.duration - 0.105);
    for (let i = 0; i < count; i++) {
      const p = i / Math.max(1, count - 1);
      key(span * p, first + i * 3, amp * (1 - p * 0.3));
    }
  };
  const flow = (opening: boolean) => {
    let low = 0,
      smooth = 0,
      body = 0,
      phase = 0,
      airPhase = 0;
    const base = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate,
        p = i / (data.length - 1),
        q = opening ? 1 - p : p;
      const rise = q * q;
      const alpha = 1 - Math.exp((-2 * Math.PI * (350 + 1800 * rise)) / sampleRate);
      low += alpha * (random() * 2 - 1 - low);
      smooth += alpha * (low - smooth);
      body += base * (smooth - body);
      phase += (2 * Math.PI * (82 + 86 * rise) * color) / sampleRate;
      airPhase += (2 * Math.PI * (420 + 1400 * rise) * color) / sampleRate;
      const pressure = Math.sin(phase) * 0.12 + Math.sin(phase * 1.497) * 0.045;
      const air = (smooth - body) * 1.7 + Math.sin(airPhase) * 0.018;
      const envelope =
        Math.min(1, t / 0.08, (spec.duration - t) / 0.018) * (0.24 + 0.76 * q ** 1.2);
      data[i] = (pressure * (1 - q * 0.3) + air) * envelope;
    }
  };
  switch (spec.recipe) {
    case 'key':
      key(0, first, 1.25);
      break;
    case 'pair':
      strokes(2, 1.05);
      break;
    case 'impact':
      add(0, recording(first).press, kind === 'rhythm-complete' ? 1.65 : 1.25, color);
      break;
    case 'inhale':
      flow(false);
      break;
    case 'exhale':
      flow(true);
      break;
  }
  const fade = Math.max(1, Math.round(sampleRate * 0.001));
  for (let i = 0; i < data.length; i++) {
    const envelope = Math.min(1, i / fade, (data.length - 1 - i) / fade);
    data[i] = Math.tanh(data[i] * 1.2) * 0.8 * envelope;
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return data;
}
