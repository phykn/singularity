import { clamp } from '../game/geometry.ts';

export function introFrame(clock: number, progress: number | null, reducedMotion = false) {
  const cycle = clock % 4.6;
  const p = progress === null ? 0 : clamp(progress);
  const ease = 1 - (1 - p) ** 3;
  const pulse = reducedMotion
    ? 0
    : progress !== null
      ? p < 0.55
        ? Math.sin((p / 0.55) * Math.PI) * 0.7
        : 0
      : cycle > 3.8 && cycle < 4.04
        ? Math.sin(((cycle - 3.8) / 0.24) * Math.PI)
        : 0;
  return {
    angle: -0.65 + (reducedMotion ? 0 : clock * 0.24 + ease * Math.PI * 0.55),
    radius: reducedMotion ? 1 : 1 - 0.9 * ease,
    core: (1 - pulse * 0.04) * (reducedMotion ? 1 : 1 - 0.88 * ease),
    alpha: 1 - 0.9 * clamp((p - 0.65) / 0.35),
    pulse,
  };
}
