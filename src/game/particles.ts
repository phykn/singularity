export const particleIds = ['quark', 'muon', 'proton', 'neutron'] as const;
export type ParticleKind = (typeof particleIds)[number];

export function particleKind(
  family: 'small' | 'dense',
  roll: number,
  stage: number,
  mix = { muonProbability: 0.25, neutronProbability: 0.5 },
): ParticleKind {
  if (family === 'small') return stage >= 1 && roll < mix.muonProbability ? 'muon' : 'quark';
  return stage >= 2 && roll < mix.neutronProbability ? 'neutron' : 'proton';
}

export function particleMotion(kind: ParticleKind, age: number) {
  if (kind !== 'muon') return { speed: 1, turn: 1, charging: false, dashing: false };
  const phase = (age + 1e-8) % 2.4;
  const charging = phase < 0.35,
    dashing = phase >= 0.35 && phase < 0.6;
  // A complete pause/dash cycle covers the same distance as steady movement.
  return {
    speed: charging ? 0 : dashing ? 2.4 : 1,
    turn: charging || dashing ? 0 : 4 / 3,
    charging,
    dashing,
  };
}
