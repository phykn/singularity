import type { RuleSet } from './rules.ts';

export const bossIds = ['gluon', 'w', 'z', 'tau', 'top', 'higgs'] as const;
export type BossKind = (typeof bossIds)[number];

export type BossPhase = {
  speed: number;
  charging: boolean;
  dashing: boolean;
  warning: boolean;
  immune: boolean;
};

// One rule per giant particle, read from its age so views and the model agree.
export function bossPhase(
  kind: BossKind,
  age: number,
  cfg: RuleSet['boss']['behaviors'],
): BossPhase {
  const phase: BossPhase = {
    speed: 1,
    charging: false,
    dashing: false,
    warning: false,
    immune: false,
  };
  const t = age + 1e-8;
  if (kind === 'z') {
    const { period, warnSeconds, immuneSeconds } = cfg.z,
      at = t % period;
    phase.immune = at >= period - immuneSeconds;
    phase.warning = !phase.immune && at >= period - immuneSeconds - warnSeconds;
  } else if (kind === 'tau') {
    const { cycle, chargeSeconds, dashSeconds, dashSpeed } = cfg.tau,
      at = t % cycle;
    phase.charging = at < chargeSeconds;
    phase.dashing = !phase.charging && at < chargeSeconds + dashSeconds;
    phase.speed = phase.charging ? 0 : phase.dashing ? dashSpeed : 1;
  } else if (kind === 'top') phase.speed = cfg.top.speed;
  return phase;
}
