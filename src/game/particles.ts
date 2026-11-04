import type { RuleSet } from './rules.ts';

export const particleIds = ['quark', 'muon', 'proton', 'neutron', 'neutrino', 'meson'] as const;
export type ParticleKind = (typeof particleIds)[number];
export type ParticleMix = { muon: number; neutrino: number; meson: number; neutron: number };

export function particleMix(
  stage: number,
  cfg: RuleSet['particles'],
  late?: RuleSet['late'],
): ParticleMix {
  return {
    muon: late ? late.muonProbability : cfg.muon[stage],
    neutrino: cfg.neutrino[stage],
    meson: cfg.meson[stage],
    neutron: late ? late.neutronProbability : cfg.neutron[stage],
  };
}

export function particleKind(
  family: 'small' | 'dense',
  roll: number,
  mix: ParticleMix,
): ParticleKind {
  if (family === 'dense') return roll < mix.neutron ? 'neutron' : 'proton';
  if (roll < mix.muon) return 'muon';
  if (roll < mix.muon + mix.neutrino) return 'neutrino';
  if (roll < mix.muon + mix.neutrino + mix.meson) return 'meson';
  return 'quark';
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
