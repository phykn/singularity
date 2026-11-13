import type { ParticleKind, Rules } from './rules.ts';

export type Family = 'small' | 'dense';
// Formations share their family's base speed and turn; species scale from it.
export const familyBase = { small: 'quark', dense: 'proton' } as const;

// A dashing particle pauses, then rushes; one cycle covers the same distance as steady motion.
export function particleMotion(cfg: Rules['particles'][ParticleKind], age: number) {
  const dash = cfg.dash;
  if (!dash) return { speed: 1, turn: 1, charging: false };
  const at = (age + 1e-8) % dash.cycle,
    charging = at < dash.chargeSeconds,
    dashing = !charging && at < dash.chargeSeconds + dash.dashSeconds;
  return {
    speed: charging ? 0 : dashing ? dash.speed : 1,
    turn: charging || dashing ? 0 : dash.turn,
    charging,
  };
}

export type Mix = Rules['stages'][number]['shares'];

// Dense batches roll neutron or proton; small ones muon, neutrino, meson, else quark.
export function particleKind(family: Family, roll: number, mix: Mix): ParticleKind {
  if (family === 'dense') return roll < mix.neutron ? 'neutron' : 'proton';
  if (roll < mix.muon) return 'muon';
  if (roll < mix.muon + mix.neutrino) return 'neutrino';
  if (roll < mix.muon + mix.neutrino + mix.meson) return 'meson';
  return 'quark';
}
