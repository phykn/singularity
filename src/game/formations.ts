import { goldenAngle } from './geometry.ts';
import type { RuleSet } from './rules.ts';

export const formationIds = ['line', 'clump', 'arrow', 'ring', 'star', 'spiral', 'pincer'] as const;
export type FormationId = (typeof formationIds)[number];
export type Slot = { theta: number; radius: number };

// Each shape debuts at its own time, so first sightings spread through the run.
export function formationsAt(seconds: number, cfg: RuleSet['formations']): FormationId[] {
  return formationIds.filter((id) => seconds >= cfg.debuts[id]);
}

// Spreads the large members of a ring evenly among the small ones.
export function interleave(dense: number, small: number): ('small' | 'dense')[] {
  const total = dense + small;
  return Array.from({ length: total }, (_, i) =>
    Math.floor(((i + 1) * dense) / total) > Math.floor((i * dense) / total) ? 'dense' : 'small',
  );
}

// Places `count` members of one shape around the core, centred on `angle` at `origin`.
// Pincer is two shapes and is laid out by the caller.
export function formationSlots(
  shape: Exclude<FormationId, 'pincer'>,
  count: number,
  angle: number,
  origin: number,
  cfg: RuleSet['formations'],
): Slot[] {
  return Array.from({ length: count }, (_, i) => {
    if (shape === 'line') return { theta: angle, radius: origin + i * cfg.lineSpacing };
    if (shape === 'ring') return { theta: angle + (i * Math.PI * 2) / count, radius: origin };
    if (shape === 'spiral')
      return {
        theta: angle + (i * Math.PI * 2 * cfg.spiralTurns) / count,
        radius: origin + i * cfg.spiralStep,
      };
    if (shape === 'star') {
      const arms = count >= 12 ? 6 : count >= 8 ? 5 : 4;
      return {
        theta: angle + ((i % arms) * Math.PI * 2) / arms,
        radius: origin + Math.floor(i / arms) * cfg.lineSpacing,
      };
    }
    if (shape === 'arrow') {
      const step = Math.ceil(i / 2),
        side = i % 2 ? 1 : -1;
      return {
        theta: angle + side * step * cfg.arrowSpread,
        radius: origin + step * cfg.arrowStep,
      };
    }
    // Clump: a sunflower disc just outside the spawn circle.
    const d = cfg.clumpRadius * Math.sqrt((i + 0.5) / count),
      phi = i * goldenAngle,
      radius = origin + cfg.clumpRadius + d * Math.cos(phi);
    return { theta: angle + (d * Math.sin(phi)) / radius, radius };
  });
}
