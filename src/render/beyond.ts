import type { Game } from '../game/Game.ts';
import { clamp } from '../game/geometry.ts';
import { BLUE, VIOLET } from '../art/palette.ts';

export function beyondFrame(game: Game, reducedMotion = false) {
  if (game.phase !== 'crossing') return null;
  const t = game.phaseProgress * game.rules.endless.entrySeconds;
  const expand = clamp((t - 0.9) / 1.5);
  const ease = 1 - (1 - expand) ** 3;
  const blend = clamp((t - 1.05) / 0.95);
  const channel = (shift: number) =>
    Math.round(
      ((BLUE >> shift) & 255) + (((VIOLET >> shift) & 255) - ((BLUE >> shift) & 255)) * blend,
    );
  return {
    stage: t < 0.75 ? 'contract' : t < 0.9 ? 'quiet' : t < 1.45 ? 'open' : 'orbit',
    ring: reducedMotion ? game.rules.orbitRadius : game.rules.orbitRadius * ease,
    core: reducedMotion ? 0 : 24 * (1 - clamp(t / 0.75)) ** 2,
    alpha: reducedMotion ? clamp((t - 0.9) / 0.6) : 1,
    electron: clamp((t - 1.05) / 0.4),
    angle: game.angle - (reducedMotion ? 0 : (1 - ease) * Math.PI),
    color: (channel(16) << 16) | (channel(8) << 8) | channel(0),
    opacity: 0.8 - 0.48 * clamp((t - 1.45) / 0.95),
    point: clamp(t / 0.75) * (1 - clamp((t - 0.9) / 0.35)),
    expand,
    reducedMotion,
  };
}
