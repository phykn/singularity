type Bus = 'hit' | 'kill' | 'skill' | 'reward' | 'rhythm' | 'transition';
type Recipe = 'pop' | 'crunch' | 'spark' | 'field' | 'rise' | 'sink' | 'bloom' | 'resonance';
type Definition = {
  bus: Bus;
  recipe: Recipe;
  duration: number;
  gain: number;
  color: number;
  variants: number;
};

// Original, dry textures: a soft body under small, rounded shell fragments.
export const soundDefinitions = {
  hit: { bus: 'hit', recipe: 'pop', duration: 0.075, gain: 0.14, color: 0.85, variants: 6 },
  dense: { bus: 'hit', recipe: 'crunch', duration: 0.14, gain: 0.2, color: 0.72, variants: 4 },
  kill: { bus: 'kill', recipe: 'crunch', duration: 0.115, gain: 0.27, color: 1, variants: 8 },
  spark: { bus: 'skill', recipe: 'spark', duration: 0.095, gain: 0.1, color: 1, variants: 4 },
  arc: { bus: 'skill', recipe: 'crunch', duration: 0.21, gain: 0.22, color: 0.65, variants: 4 },
  field: { bus: 'skill', recipe: 'field', duration: 0.29, gain: 0.15, color: 1, variants: 3 },
  charge: { bus: 'skill', recipe: 'spark', duration: 0.22, gain: 0.17, color: 0.8, variants: 3 },
  surge: { bus: 'skill', recipe: 'crunch', duration: 0.25, gain: 0.18, color: 0.85, variants: 3 },
  vent: { bus: 'skill', recipe: 'field', duration: 0.24, gain: 0.17, color: 0.65, variants: 3 },
  level: { bus: 'reward', recipe: 'bloom', duration: 0.36, gain: 0.22, color: 1.7, variants: 3 },
  wave: { bus: 'transition', recipe: 'sink', duration: 0.4, gain: 0.19, color: 0.8, variants: 2 },
  charged: { bus: 'transition', recipe: 'rise', duration: 0.72, gain: 0.24, color: 1, variants: 1 },
  collision: {
    bus: 'transition',
    recipe: 'crunch',
    duration: 0.48,
    gain: 0.34,
    color: 0.45,
    variants: 1,
  },
  ending: {
    bus: 'transition',
    recipe: 'bloom',
    duration: 0.4,
    gain: 0.4,
    color: 0.35,
    variants: 1,
  },
  'ending-compress': {
    bus: 'transition',
    recipe: 'rise',
    duration: 1.05,
    gain: 0.29,
    color: 0.65,
    variants: 1,
  },
  'ending-resonance': {
    bus: 'transition',
    recipe: 'resonance',
    duration: 1.55,
    gain: 0.26,
    color: 0.6,
    variants: 1,
  },
  'beyond-contract': {
    bus: 'transition',
    recipe: 'sink',
    duration: 0.55,
    gain: 0.27,
    color: 0.6,
    variants: 1,
  },
  'beyond-open': {
    bus: 'transition',
    recipe: 'bloom',
    duration: 0.55,
    gain: 0.3,
    color: 0.75,
    variants: 1,
  },
  'rhythm-1': {
    bus: 'rhythm',
    recipe: 'pop',
    duration: 0.13,
    gain: 0.32,
    color: 1.15,
    variants: 3,
  },
  'rhythm-2': { bus: 'rhythm', recipe: 'pop', duration: 0.16, gain: 0.34, color: 1.3, variants: 3 },
  'rhythm-complete': {
    bus: 'rhythm',
    recipe: 'bloom',
    duration: 0.37,
    gain: 0.4,
    color: 1.05,
    variants: 4,
  },
  'rhythm-miss': {
    bus: 'rhythm',
    recipe: 'pop',
    duration: 0.085,
    gain: 0.1,
    color: 0.55,
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
  const body = (at: number, duration: number, freq: number, amp: number) => {
    let phase = 0;
    add(at, duration, (t, p) => {
      phase += (Math.PI * 2 * freq * (0.64 + 0.36 * Math.exp(-t * 65))) / sampleRate;
      const env = (1 - Math.exp(-t * 1200)) * Math.exp(-p * 5.5) * (1 - p) ** 2;
      return (Math.sin(phase) + Math.sin(phase * 1.98) * 0.12) * env * amp;
    });
  };
  const grain = (at: number, duration: number, cutoff: number, amp: number) => {
    let low = 0,
      smooth = 0;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    add(at, duration, (t, p) => {
      low += alpha * (random() * 2 - 1 - low);
      smooth += alpha * (low - smooth);
      return smooth * (1 - Math.exp(-t * 4500)) * Math.exp(-p * 7) * (1 - p) ** 2 * amp;
    });
  };
  const fragments = (count: number, span: number, amp: number) => {
    for (let i = 0; i < count; i++) {
      const at = 0.003 + (i / count) ** 1.4 * span + random() * 0.004;
      grain(
        at,
        0.006 + random() * 0.013,
        (1700 + random() * 2100) * color,
        amp * (0.5 + random() * 0.5) * (1 - i / (count * 1.3)),
      );
    }
  };
  const air = (reverse: boolean, amp: number) => {
    let low = 0,
      smooth = 0;
    add(0, spec.duration, (t, p) => {
      const q = reverse ? 1 - p : p;
      const alpha = 1 - Math.exp((-2 * Math.PI * (350 + q * 2300) * color) / sampleRate);
      low += alpha * (random() * 2 - 1 - low);
      smooth += alpha * (low - smooth);
      return smooth * Math.sin(Math.PI * p) ** 1.5 * (0.8 + 0.2 * Math.sin(t * 28)) * amp;
    });
  };
  const resonance = (freq: number, amp: number) => {
    add(0, spec.duration, (t, p) => {
      const env = (1 - Math.exp(-t * 100)) * Math.exp(-p * 3) * (1 - p) ** 2;
      return (
        (Math.sin(t * Math.PI * 2 * freq) * 0.65 +
          Math.sin(t * Math.PI * 2 * freq * 1.501) * 0.23 +
          Math.sin(t * Math.PI * 2 * freq * 2.003) * 0.12) *
        env *
        amp
      );
    });
  };
  switch (spec.recipe) {
    case 'pop':
      body(0, spec.duration, 360 * color, 0.7);
      grain(0.001, 0.012, 2300 * color, 0.6);
      fragments(3, 0.028, 0.35);
      break;
    case 'crunch':
      body(0, spec.duration, 240 * color, 0.65);
      grain(0, 0.02, 3100 * color, 1.15);
      fragments(kind === 'kill' ? 9 : 13, spec.duration * 0.65, 1.05);
      if (spec.duration > 0.2) resonance(100 * color, 0.3);
      break;
    case 'spark':
      body(0, spec.duration, 310 * color, 0.35);
      fragments(12, spec.duration * 0.8, 0.9);
      break;
    case 'field':
      body(0, spec.duration, 165 * color, 0.45);
      air(true, 0.55);
      fragments(5, spec.duration * 0.5, 0.35);
      break;
    case 'rise':
      air(false, 1.1);
      resonance(155 * color, 0.28);
      // Accelerating grains suggest compression without an arcade pitch sweep.
      for (let i = 0; i < 22; i++)
        grain(
          spec.duration * (1 - (1 - i / 24) ** 1.9),
          0.016,
          (900 + i * 55) * color,
          0.3 + i * 0.015,
        );
      break;
    case 'sink':
      air(true, 0.7);
      body(0, spec.duration, 190 * color, 0.65);
      resonance(120 * color, 0.2);
      break;
    case 'bloom':
      body(0, spec.duration, 210 * color, 0.8);
      grain(0, 0.032, 2400 * color, 1.2);
      fragments(16, 0.11, 0.8);
      resonance(165 * color, 0.42);
      air(true, 0.2);
      break;
    case 'resonance':
      resonance(110 * color, 0.7);
      air(true, 0.18);
      break;
  }
  // Rounded transients and silent boundaries even at altered playback speeds.
  let dc = 0;
  for (const sample of data) dc += sample / data.length;
  const fade = Math.max(1, Math.round(sampleRate * 0.003));
  for (let i = 0; i < data.length; i++) {
    const envelope = Math.min(1, i / fade, (data.length - 1 - i) / fade);
    data[i] = Math.tanh((data[i] - dc) * 1.2) * 0.8 * envelope;
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return data;
}
