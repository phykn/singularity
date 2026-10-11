type Bus = 'hit' | 'kill' | 'skill' | 'rhythm' | 'transition';
type Recipe = 'fold' | 'crumple' | 'brush' | 'gather' | 'unfold' | 'settle';
type Definition = {
  bus: Bus;
  recipe: Recipe;
  duration: number;
  gain: number;
  color: number;
  variants: number;
};

// Dry paper friction and irregular folds share one material across every cue.
export const soundDefinitions = {
  hit: { bus: 'hit', recipe: 'fold', duration: 0.16, gain: 0.22, color: 1, variants: 8 },
  dense: { bus: 'hit', recipe: 'crumple', duration: 0.22, gain: 0.26, color: 0.75, variants: 6 },
  kill: { bus: 'kill', recipe: 'crumple', duration: 0.23, gain: 0.32, color: 1.05, variants: 10 },
  spark: { bus: 'skill', recipe: 'crumple', duration: 0.11, gain: 0.11, color: 1.15, variants: 4 },
  arc: { bus: 'skill', recipe: 'crumple', duration: 0.26, gain: 0.27, color: 0.65, variants: 4 },
  field: { bus: 'skill', recipe: 'brush', duration: 0.3, gain: 0.14, color: 0.8, variants: 3 },
  charge: { bus: 'skill', recipe: 'gather', duration: 0.32, gain: 0.16, color: 1, variants: 3 },
  surge: { bus: 'skill', recipe: 'fold', duration: 0.3, gain: 0.22, color: 0.7, variants: 3 },
  vent: { bus: 'skill', recipe: 'unfold', duration: 0.3, gain: 0.18, color: 0.85, variants: 3 },
  wave: {
    bus: 'transition',
    recipe: 'crumple',
    duration: 0.4,
    gain: 0.24,
    color: 0.62,
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
    recipe: 'crumple',
    duration: 0.48,
    gain: 0.34,
    color: 0.55,
    variants: 1,
  },
  ending: {
    bus: 'transition',
    recipe: 'unfold',
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
    color: 0.7,
    variants: 1,
  },
  'ending-resonance': {
    bus: 'transition',
    recipe: 'settle',
    duration: 1.55,
    gain: 0.26,
    color: 0.75,
    variants: 1,
  },
  'beyond-contract': {
    bus: 'transition',
    recipe: 'gather',
    duration: 0.55,
    gain: 0.25,
    color: 0.8,
    variants: 1,
  },
  'beyond-open': {
    bus: 'transition',
    recipe: 'unfold',
    duration: 0.55,
    gain: 0.35,
    color: 0.85,
    variants: 1,
  },
  'rhythm-complete': {
    bus: 'rhythm',
    recipe: 'unfold',
    duration: 0.32,
    gain: 0.47,
    color: 0.95,
    variants: 4,
  },
} satisfies Record<string, Definition>;

export type SoundKind = keyof typeof soundDefinitions;
export type SoundBus = Bus;

export function synthesizeSound(kind: SoundKind, sampleRate: number, variant = 0): Float32Array {
  const spec = soundDefinitions[kind];
  const data = new Float32Array(Math.ceil(spec.duration * sampleRate));
  let seed = 2166136261;
  for (const char of kind) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  seed ^= Math.imul(variant + 1, 0x9e3779b9);
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const color = spec.color * (0.94 + random() * 0.12);
  const add = (at: number, duration: number, sample: (p: number) => number) => {
    const start = Math.round(at * sampleRate),
      count = Math.ceil(duration * sampleRate);
    for (let i = 0; i < count && start + i < data.length; i++) data[start + i] += sample(i / count);
  };

  // Noise bands give folds a papery surface without a pitched thud or snap.
  const grain = (at: number, duration: number, amp: number, shade = 1) => {
    let low = 0,
      smooth = 0,
      body = 0;
    const cutoff = Math.min(sampleRate * 0.3, 3400 * color * shade);
    const fast = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    const base = 1 - Math.exp((-2 * Math.PI * 650 * color) / sampleRate);
    add(at, duration, (p) => {
      low += fast * (random() * 2 - 1 - low);
      smooth += fast * (low - smooth);
      const surface = low * 0.18 + smooth * 0.82;
      body += base * (surface - body);
      const envelope = Math.min(1, p / 0.22) ** 1.4 * (1 - p) ** 1.5;
      return (surface - body) * envelope * amp;
    });
  };
  const folds = (count: number, start: number, span: number, amp: number, gather = false) => {
    for (let i = 0; i < count; i++) {
      const p = Math.max(0, Math.min(1, (i + (random() - 0.5) * 0.55) / Math.max(1, count - 1)));
      const at = start + span * (gather ? 1 - (1 - p) ** 1.6 : p) + random() * 0.004;
      const duration = Math.min(spec.duration - at, 0.035 + random() * 0.025);
      const strength = amp * (0.8 + random() * 0.35) * (gather ? 0.65 + p * 0.35 : 1 - p * 0.22);
      grain(at, duration, strength, 0.82 + random() * 0.36);
      grain(at + duration * 0.28, duration * 0.6, strength * 0.45, 1.15);
    }
  };
  const brush = (duration: number, amp: number, rise = false) => {
    let low = 0,
      smooth = 0,
      body = 0,
      motion = 0.5,
      next = 0.5,
      step = 0;
    const fast = 1 - Math.exp((-2 * Math.PI * 2600 * color) / sampleRate);
    const base = 1 - Math.exp((-2 * Math.PI * 500) / sampleRate);
    const glide = 1 - Math.exp(-90 / sampleRate);
    add(0, duration, (p) => {
      if (step-- <= 0) {
        next = 0.3 + random() * 0.7;
        step = Math.round(sampleRate * (0.009 + random() * 0.018));
      }
      motion += glide * (next - motion);
      low += fast * (random() * 2 - 1 - low);
      smooth += fast * (low - smooth);
      body += base * (smooth - body);
      const envelope = Math.min(1, p / 0.08) * (1 - p) ** 1.4 * (rise ? 0.3 + p * 1.2 : 1);
      return (smooth - body) * envelope * motion * amp;
    });
  };
  switch (spec.recipe) {
    case 'fold':
      brush(spec.duration * 0.88, 0.65);
      folds(3, 0.002, spec.duration * 0.52, 2.4);
      break;
    case 'crumple':
      brush(spec.duration * 0.9, 0.8);
      folds(6, 0.003, spec.duration * 0.58, 2.1);
      break;
    case 'brush':
      brush(spec.duration, 2.2);
      folds(4, 0.009, spec.duration * 0.48, 0.55);
      break;
    case 'gather':
      brush(spec.duration, 1.3, true);
      folds(8, 0.008, spec.duration * 0.74, 1.8, true);
      break;
    case 'unfold':
      brush(spec.duration * 0.95, 1.15);
      folds(7, 0.002, spec.duration * 0.62, 2.2);
      break;
    case 'settle':
      brush(spec.duration, 1.25);
      folds(6, 0.015, spec.duration * 0.5, 0.65);
      break;
  }
  let dc = 0;
  for (const sample of data) dc += sample / data.length;
  const fade = Math.max(1, Math.round(sampleRate * 0.004));
  for (let i = 0; i < data.length; i++) {
    const envelope = Math.min(1, i / fade, (data.length - 1 - i) / fade);
    data[i] = Math.tanh((data[i] - dc) * 1.2) * 0.8 * envelope;
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return data;
}
