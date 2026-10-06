import type { Game } from '../game/Game.ts';
import { clamp } from '../game/geometry.ts';

export function beyondFrame(game: Game, reducedMotion = false) {
  if (game.phase !== 'crossing') return null;
  const t = game.phaseProgress * game.rules.endless.entrySeconds;
  const expand = clamp((t - 0.9) / 1.5);
  const ease = 1 - (1 - expand) ** 3;
  return {
    stage: t < 0.75 ? 'contract' : t < 0.9 ? 'quiet' : t < 1.45 ? 'open' : 'orbit',
    ring: reducedMotion ? game.rules.orbitRadius : 3 + (game.rules.orbitRadius - 3) * ease,
    core: 24 - 22 * clamp(t / 0.75),
    alpha: reducedMotion ? clamp((t - 0.9) / 0.6) : 1,
    electron: clamp((t - 1.05) / 0.4),
    angle: game.angle - (reducedMotion ? 0 : (1 - ease) * Math.PI),
    expand,
    reducedMotion,
  };
}
