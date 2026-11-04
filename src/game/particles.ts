import type { RuleSet } from './rules.ts';

export const particleIds = ['quark', 'muon', 'proton', 'neutron', 'neutrino', 'meson'] as const;
export type ParticleKind = (typeof particleIds)[number];
export type ParticleMix = { muon: number; neutrino: number; meson: number; neutron: number };

// `progress` is how far the run is through the stage (0 to 1). A species'
// share grows from the previous stage's over the first `ramp` of the stage,
// so a newcomer arrives gradually instead of all at once.
export function particleMix(
  stage: number,
  cfg: RuleSet['particles'],
  late?: RuleSet['late'],
  progress = 1,
): ParticleMix {
  const blend = Math.min(1, progress / cfg.ramp);
  const share = (values: readonly number[]) => rampedShare(values, stage, blend);
  return {
    muon: late ? late.muonProbability : share(cfg.muon),
    neutrino: share(cfg.neutrino),
    meson: share(cfg.meson),
    neutron: late ? late.neutronProbability : share(cfg.neutron),
  };
}

// A per-stage share partway (`blend`, 0 to 1) from the previous stage's value to this stage's.
export function rampedShare(values: readonly number[], stage: number, blend: number): number {
  return stage ? values[stage - 1] + (values[stage] - values[stage - 1]) * blend : values[0];
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
