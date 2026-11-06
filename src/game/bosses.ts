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
export function bossPhase(kind: BossKind, age: number, b: Record<string, number>): BossPhase {
  const phase = { speed: 1, charging: false, dashing: false, warning: false, immune: false },
    t = age + 1e-8;
  if (kind === 'z') {
    const at = t % b.period;
    phase.immune = at >= b.period - b.immuneSeconds;
    phase.warning = !phase.immune && at >= b.period - b.immuneSeconds - b.warnSeconds;
  } else if (kind === 'tau') {
    const at = t % b.cycle;
    phase.charging = at < b.chargeSeconds;
    phase.dashing = !phase.charging && at < b.chargeSeconds + b.dashSeconds;
    phase.speed = phase.charging ? 0 : phase.dashing ? b.dashSpeed : 1;
  } else if (kind === 'top') phase.speed = b.speed;
  return phase;
}
