import { TAU, goldenAngle } from './geometry.ts';
import type { Family } from './particles.ts';
import type { Rules } from './rules.ts';

const formationIds = ['line', 'clump', 'arrow', 'ring', 'star', 'spiral', 'pincer'] as const;
export type FormationId = (typeof formationIds)[number];
// A pincer is two of the other shapes from opposite sides.
export type Shape = Exclude<FormationId, 'pincer'>;

// Each shape debuts at its own time, so first sightings spread through the run.
export const formationsAt = (seconds: number, cfg: Rules['formations']): FormationId[] =>
  formationIds.filter((id) => seconds >= cfg[id].debut);

// Spreads the large members of a ring evenly among the small ones.
export function interleave(dense: number, small: number): Family[] {
  const total = dense + small;
  return Array.from({ length: total }, (_, i) =>
    Math.floor(((i + 1) * dense) / total) > Math.floor((i * dense) / total) ? 'dense' : 'small',
  );
}

// `count` members of one shape around the core, centred on `angle` at `origin`.
export function formationSlots(
  shape: Shape,
  count: number,
  angle: number,
  origin: number,
  cfg: Rules['formations'],
): { theta: number; radius: number }[] {
  return Array.from({ length: count }, (_, i) => {
    if (shape === 'line') return { theta: angle, radius: origin + i * cfg.line.spacing };
    if (shape === 'ring') return { theta: angle + (i * TAU) / count, radius: origin };
    if (shape === 'spiral')
      return {
        theta: angle + (i * TAU * cfg.spiral.turns) / count,
        radius: origin + i * cfg.spiral.step,
      };
    if (shape === 'star') {
      const arms = count >= 12 ? 6 : count >= 8 ? 5 : 4;
      return {
        theta: angle + ((i % arms) * TAU) / arms,
        radius: origin + Math.floor(i / arms) * cfg.star.spacing,
      };
    }
    if (shape === 'arrow') {
      const step = Math.ceil(i / 2);
      return {
        theta: angle + (i % 2 ? 1 : -1) * step * cfg.arrow.spread,
        radius: origin + step * cfg.arrow.step,
      };
    }
    // Clump: a sunflower disc just outside the spawn circle.
    const d = cfg.clump.radius * Math.sqrt((i + 0.5) / count),
      phi = i * goldenAngle,
      radius = origin + cfg.clump.radius + d * Math.cos(phi);
    return { theta: angle + (d * Math.sin(phi)) / radius, radius };
  });
}
