import { clamp } from '../game/geometry.ts';

export const launchMilliseconds = 400;

export function introFrame(clock: number, progress: number | null, reducedMotion = false) {
  const cycle = clock % 4.6;
  const p = progress === null ? 0 : clamp(progress);
  const settle = p * p * (3 - 2 * p);
  const pulse =
    reducedMotion || progress !== null
      ? 0
      : cycle > 3.8 && cycle < 4.04
        ? Math.sin(((cycle - 3.8) / 0.24) * Math.PI)
        : 0;
  return {
    angle: -0.65 + (reducedMotion ? 0 : clock * 0.24),
    core: 1 - pulse * 0.04,
    settle,
    pulse,
  };
}
