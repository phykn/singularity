type Bus = 'hit' | 'kill' | 'skill' | 'rhythm' | 'transition';
type Recipe = 'press' | 'wet' | 'thock' | 'crumble' | 'flow' | 'compress' | 'release' | 'resonance';
type Definition = {
  bus: Bus;
  recipe: Recipe;
  duration: number;
  gain: number;
  color: number;
  variants: number;
};

// Short contact bodies leave room for the clear wet or solid surface texture.
export const soundDefinitions = {
  hit: { bus: 'hit', recipe: 'press', duration: 0.14, gain: 0.2, color: 1, variants: 6 },
  dense: { bus: 'hit', recipe: 'thock', duration: 0.18, gain: 0.25, color: 0.78, variants: 4 },
  kill: { bus: 'kill', recipe: 'wet', duration: 0.18, gain: 0.32, color: 1, variants: 8 },
  spark: { bus: 'skill', recipe: 'crumble', duration: 0.11, gain: 0.11, color: 1.15, variants: 4 },
  arc: { bus: 'skill', recipe: 'thock', duration: 0.26, gain: 0.27, color: 0.65, variants: 4 },
  field: { bus: 'skill', recipe: 'flow', duration: 0.3, gain: 0.14, color: 0.8, variants: 3 },
  charge: { bus: 'skill', recipe: 'flow', duration: 0.26, gain: 0.16, color: 1, variants: 3 },
  surge: { bus: 'skill', recipe: 'press', duration: 0.3, gain: 0.22, color: 0.7, variants: 3 },
  vent: { bus: 'skill', recipe: 'release', duration: 0.3, gain: 0.18, color: 0.85, variants: 3 },
  wave: { bus: 'transition', recipe: 'thock', duration: 0.4, gain: 0.24, color: 0.62, variants: 2 },
  charged: {
    bus: 'transition',
    recipe: 'compress',
    duration: 0.72,
    gain: 0.24,
    color: 0.9,
    variants: 1,
  },
  collision: {
    bus: 'transition',
    recipe: 'crumble',
    duration: 0.48,
    gain: 0.34,
    color: 0.55,
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
    recipe: 'compress',
    duration: 1.05,
    gain: 0.3,
    color: 0.7,
    variants: 1,
  },
  'ending-resonance': {
    bus: 'transition',
    recipe: 'resonance',
    duration: 1.55,
    gain: 0.26,
    color: 0.75,
    variants: 1,
  },
  'beyond-contract': {
    bus: 'transition',
    recipe: 'compress',
    duration: 0.55,
    gain: 0.25,
    color: 0.8,
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
  'rhythm-1': {
    bus: 'rhythm',
    recipe: 'thock',
    duration: 0.17,
    gain: 0.36,
    color: 1,
    variants: 4,
  },
  'rhythm-2': { bus: 'rhythm', recipe: 'thock', duration: 0.2, gain: 0.4, color: 0.9, variants: 4 },
  'rhythm-complete': {
    bus: 'rhythm',
    recipe: 'release',
    duration: 0.32,
    gain: 0.47,
    color: 0.95,
    variants: 4,
  },
  'rhythm-miss': {
    bus: 'rhythm',
    recipe: 'press',
    duration: 0.1,
    gain: 0.12,
    color: 0.7,
    variants: 2,
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
  const add = (at: number, duration: number, sample: (t: number, p: number) => number) => {
    const start = Math.round(at * sampleRate),
      count = Math.ceil(duration * sampleRate);
    for (let i = 0; i < count && start + i < data.length; i++)
      data[start + i] += sample(i / sampleRate, i / count);
  };
  const cavity = (at: number, duration: number, freq: number, amp: number, wet = false) => {
    let phase = 0,
      attack = 1,
      decay = 1,
      fall = 1,
      mid = 1,
      high = 1;
    const a = Math.exp(-(wet ? 700 : 220) / sampleRate),
      d = Math.exp(-3.6 / Math.ceil(duration * sampleRate)),
      f = Math.exp(-30 / sampleRate),
      m = Math.exp(-45 / sampleRate),
      h = Math.exp(-110 / sampleRate),
      step = (Math.PI * 2 * freq) / sampleRate;
    add(at, duration, (_t, p) => {
      phase += step * (wet ? 0.65 + p * 0.9 : 0.82 + 0.18 * fall);
      const env = (1 - attack) * decay * (1 - p) ** 2;
      const value =
        (Math.sin(phase) +
          Math.sin(phase * 2.07) * 0.25 * mid +
          Math.sin(phase * 4.31) * 0.12 * high) *
        env *
        amp;
      attack *= a;
      decay *= d;
      fall *= f;
      mid *= m;
      high *= h;
      return value;
    });
  };
  const rub = (at: number, duration: number, cutoff: number, amp: number, swell = false) => {
    let low = 0,
      smooth = 0,
      bass = 0,
      attack = 1,
      decay = 1;
    const base = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate),
      fast = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate),
      slow = 1 - Math.exp((-2 * Math.PI * cutoff * 0.65) / sampleRate),
      a = Math.exp(-1200 / sampleRate),
      d = Math.exp(-3 / Math.ceil(duration * sampleRate));
    const wobble = random() * Math.PI * 2;
    add(at, duration, (t, p) => {
      const alpha = fast * (1 - p) + slow * p;
      low += alpha * (random() * 2 - 1 - low);
      smooth += alpha * (low - smooth);
      const surface = low * 0.35 + smooth * 0.65;
      bass += base * (surface - bass);
      const env = swell ? (4 * p * (1 - p)) ** 1.2 : (1 - attack) * decay * (1 - p) ** 2;
      attack *= a;
      decay *= d;
      return (
        (surface - bass) *
        env *
        (0.72 + 0.16 * Math.sin(t * 190 + wobble) + 0.12 * Math.sin(t * 310 + wobble)) *
        amp
      );
    });
  };
  const press = (at: number, duration: number, amp: number) => {
    cavity(at, Math.min(0.07, duration * 0.55), 185 * color, amp * 0.4);
    rub(at + 0.003, duration * 0.65, 3000 * color, amp * 2.1);
  };
  const bubbles = (count: number, span: number, amp: number) => {
    for (let i = 0; i < count; i++) {
      const at = 0.012 + (i / count) ** 1.3 * span + random() * 0.006,
        duration = 0.028 + random() * 0.022;
      cavity(
        at,
        duration,
        (380 + random() * 260) * color,
        (amp * (0.75 + random() * 0.25)) / (1 + i * 0.3),
        true,
      );
      rub(at, duration, 2600 * color, amp * 0.4);
    }
  };
  const crumble = (count: number, span: number, amp: number) => {
    for (let i = 0; i < count; i++)
      rub(
        0.002 + (i / count) ** 1.4 * span + random() * 0.005,
        0.014 + random() * 0.018,
        (1300 + random() * 1700) * color,
        (amp * (0.7 + random() * 0.3)) / (1 + i * 0.15),
      );
  };
  const resonance = (freq: number, amp: number) => {
    add(0, spec.duration, (t, p) => {
      const env = (1 - Math.exp(-t * 100)) * Math.exp(-p * 3) * (1 - p) ** 2;
      return (
        (Math.sin(t * Math.PI * 2 * freq) * 0.65 +
          Math.sin(t * Math.PI * 2 * freq * 2.01) * 0.23 +
          Math.sin(t * Math.PI * 2 * freq * 3.07) * 0.12) *
        env *
        amp
      );
    });
  };
  switch (spec.recipe) {
    case 'press':
      press(0, spec.duration, 1);
      rub(0.005, spec.duration * 0.65, 2600 * color, 1.4);
      break;
    case 'wet':
      press(0, spec.duration, 0.85);
      rub(0.004, spec.duration * 0.65, 3200 * color, 2.1);
      bubbles(3, spec.duration * 0.38, 0.4);
      break;
    case 'thock':
      press(0, spec.duration, 1.05);
      cavity(0.002, 0.022, 510 * color, 0.18);
      rub(0, 0.032, 3600 * color, 2.4);
      rub(0.035, 0.035, 1800 * color, 0.4);
      break;
    case 'crumble':
      press(0, spec.duration, 0.8);
      crumble(8, spec.duration * 0.65, 1.3);
      break;
    case 'flow':
      press(0, spec.duration, 0.4);
      rub(0, spec.duration, 2200 * color, 1.8, true);
      bubbles(3, spec.duration * 0.55, 0.3);
      break;
    case 'compress':
      rub(0, spec.duration, 1900 * color, 1.65, true);
      for (let i = 0; i < 7; i++)
        press(spec.duration * (1 - (1 - i / 8) ** 1.6), spec.duration * 0.18, 0.3 + i * 0.06);
      resonance(145 * color, 0.1);
      break;
    case 'release':
      press(0, spec.duration, 0.85);
      rub(0, spec.duration * 0.6, 2800 * color, 2.3);
      bubbles(4, Math.min(0.11, spec.duration * 0.4), 0.4);
      crumble(5, 0.08, 0.55);
      resonance(150 * color, 0.08);
      break;
    case 'resonance':
      resonance(145 * color, 0.35);
      rub(0, spec.duration, 1500 * color, 0.8, true);
      break;
  }
  // Rounded transients and silent boundaries even at altered playback speeds.
  let dc = 0;
  for (const sample of data) dc += sample / data.length;
  const fade = Math.max(1, Math.round(sampleRate * 0.003));
  const alpha = 1 - Math.exp((-2 * Math.PI * 55) / sampleRate);
  let low = 0;
  for (let i = 0; i < data.length; i++) {
    const envelope = Math.min(1, i / fade, (data.length - 1 - i) / fade);
    const sample = data[i] - dc;
    low += alpha * (sample - low);
    data[i] = Math.tanh((sample - low) * 1.2) * 0.8 * envelope;
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return data;
}
