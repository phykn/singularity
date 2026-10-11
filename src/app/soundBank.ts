import bank from '../audio/keycaps.json' with { type: 'json' };

type Bus = 'hit' | 'kill' | 'skill' | 'rhythm' | 'transition';
type Recipe = 'key' | 'pair' | 'roll' | 'gather' | 'release' | 'settle';
type Definition = {
  bus: Bus;
  recipe: Recipe;
  duration: number;
  gain: number;
  color: number;
  variants: number;
};

// Recorded downstrokes and return contacts keep the same keycap material across cues.
export const soundDefinitions = {
  hit: { bus: 'hit', recipe: 'key', duration: 0.12, gain: 0.3, color: 1, variants: 8 },
  dense: { bus: 'hit', recipe: 'key', duration: 0.14, gain: 0.3, color: 0.92, variants: 6 },
  kill: { bus: 'kill', recipe: 'pair', duration: 0.16, gain: 0.32, color: 1.05, variants: 10 },
  spark: { bus: 'skill', recipe: 'pair', duration: 0.11, gain: 0.11, color: 1.15, variants: 4 },
  arc: { bus: 'skill', recipe: 'pair', duration: 0.26, gain: 0.27, color: 0.94, variants: 4 },
  field: { bus: 'skill', recipe: 'roll', duration: 0.3, gain: 0.14, color: 0.94, variants: 3 },
  charge: { bus: 'skill', recipe: 'gather', duration: 0.32, gain: 0.16, color: 1, variants: 3 },
  surge: { bus: 'skill', recipe: 'key', duration: 0.3, gain: 0.22, color: 0.94, variants: 3 },
  vent: { bus: 'skill', recipe: 'release', duration: 0.3, gain: 0.18, color: 0.85, variants: 3 },
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
    recipe: 'gather',
    duration: 0.72,
    gain: 0.24,
    color: 0.9,
    variants: 1,
  },
  collision: {
    bus: 'transition',
    recipe: 'pair',
    duration: 0.48,
    gain: 0.34,
    color: 0.94,
    variants: 1,
  },
  ending: {
    bus: 'transition',
    recipe: 'release',
    duration: 0.4,
    gain: 0.43,
    color: 0.65,
    variants: 1,
  },
  'ending-compress': {
    bus: 'transition',
    recipe: 'gather',
    duration: 1.05,
    gain: 0.3,
    color: 0.94,
    variants: 1,
  },
  'ending-resonance': {
    bus: 'transition',
    recipe: 'settle',
    duration: 1.55,
    gain: 0.26,
    color: 0.94,
    variants: 1,
  },
  'beyond-contract': {
    bus: 'transition',
    recipe: 'gather',
    duration: 0.55,
    gain: 0.25,
    color: 0.94,
    variants: 1,
  },
  'beyond-open': {
    bus: 'transition',
    recipe: 'release',
    duration: 0.55,
    gain: 0.35,
    color: 0.85,
    variants: 1,
  },
  'rhythm-complete': {
    bus: 'rhythm',
    recipe: 'release',
    duration: 0.32,
    gain: 0.47,
    color: 0.95,
    variants: 4,
  },
} satisfies Record<string, Definition>;

export type SoundKind = keyof typeof soundDefinitions;
export type SoundBus = Bus;

const recordings = new Map<number, { press: Float32Array; release: Float32Array }>();
function recording(index: number) {
  let key = recordings.get(index);
  if (!key) {
    const decode = (encoded: string) => {
      const raw = atob(encoded),
        samples = new Float32Array(raw.length / 2);
      for (let i = 0; i < samples.length; i++) {
        const value = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
        samples[i] = ((value << 16) >> 16) / 32768;
      }
      return samples;
    };
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
  const first = ((seed >>> 0) + variant * 5) % bank.keys.length;
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
    const source = recording(index % bank.keys.length);
    const pitch = color * (0.98 + random() * 0.04);
    add(at, source.press, amp, pitch);
    add(at + 0.046 + random() * 0.006, source.release, amp * 0.28, pitch * 1.04);
  };
  const strokes = (count: number, amp: number, gather = false) => {
    const span = Math.max(0, spec.duration - 0.105);
    for (let i = 0; i < count; i++) {
      const p = i / Math.max(1, count - 1);
      const at = span * (gather ? 1 - (1 - p) ** 1.6 : p);
      key(at, first + i * 3, amp * (gather ? 0.6 + p * 0.4 : 1 - p * 0.3));
    }
  };
  switch (spec.recipe) {
    case 'key':
      key(0, first, 1.25);
      break;
    case 'pair':
      strokes(2, 1.05);
      break;
    case 'roll':
      strokes(4, 0.7);
      break;
    case 'gather':
      strokes(7, 0.8, true);
      break;
    case 'release':
      strokes(4, 0.85);
      break;
    case 'settle':
      strokes(4, 0.5);
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
