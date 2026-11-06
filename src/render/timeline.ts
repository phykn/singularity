import { BLUE, VIOLET } from '../art/palette.ts';
import { clamp, orbit } from '../game/geometry.ts';
import type { Game } from '../game/Game.ts';

// Shared by the scene, the HUD and sound: pure stages of the ending and of crossing into endless.
export const singularitySilenceSeconds = 0.15;

export function arenaViewport(width: number, height: number) {
  const scale = Math.min(width, height) / 360;
  return { scale, centerY: height > width ? Math.max(170 * scale + 8, height * 0.42) : height / 2 };
}

export function endingFrame(game: Game) {
  if (!['collapse', 'ending', 'result'].includes(game.phase)) return null;
  const success = game.outcome === 'success',
    collapsing = game.phase === 'collapse',
    p = game.phase === 'result' ? 1 : clamp(game.phaseProgress),
    t = game.rules.time;
  const f = {
    stage: '',
    success,
    radius: 0,
    angle: game.angle,
    absorb: 0,
    core: 1,
    hole: 0,
    glow: 0,
    hud: 1,
    flash: 0,
    fracture: 0,
  };
  const contactAngle = game.angle + Math.PI * 2.6,
    contactRadius = Math.min(game.radius, game.core * 0.92);
  if (success && collapsing) {
    const still = 1 - singularitySilenceSeconds / t.collisionSeconds,
      q = clamp((p - 0.34) / (still - 0.34));
    f.stage = p < 0.34 ? 'accelerate' : p < still ? 'compress' : 'silence';
    f.radius = game.radius * (1 - 0.06 * clamp(p / 0.34)) * (1 - q) ** 2;
    f.core = (1 - q) ** 2;
    f.angle += Math.PI * (p < 0.34 ? 0.8 * (p / 0.34) ** 2 : 0.8 + q * 5.5);
    f.absorb = q;
    f.hud = 1 - 0.78 * clamp(p / 0.88);
  } else if (success) {
    const s = p * t.successEndingSeconds;
    f.stage = s < 0.4 ? 'formation' : s < 2.1 ? 'settle' : 'quiet';
    f.hole = s < 0.4 ? [2, 5, 10, 17, 24][Math.min(4, Math.floor(s / 0.08))] : 24;
    f.glow = (1 - clamp((s - 0.08) / 0.8)) ** 2;
    f.hud = 0.22;
    f.absorb = 1;
    f.flash = 1 - clamp(s / 0.12);
  } else if (collapsing) {
    const q = clamp((p - 0.25) / 0.75);
    f.stage = p < 0.25 ? 'unstable' : 'spiral';
    f.radius = game.radius + (contactRadius - game.radius) * q ** 1.5;
    f.angle += Math.PI * (p * 1.2 + q * q * 1.4);
    f.fracture = clamp((p - 0.15) / 0.25);
    f.absorb = clamp((p - 0.5) / 0.5);
  } else {
    const s = p * t.failureEndingSeconds;
    f.stage = s < 0.2 ? 'impact' : 'empty';
    f.flash = 1 - clamp(s / 0.2);
    f.fracture = 1;
    f.absorb = 1;
  }
  return {
    ...f,
    contact: success ? null : orbit(contactAngle, contactRadius),
    contactFrom: success
      ? null
      : orbit(contactAngle, game.radius + game.rules.orbit.electronRadius * 2),
    contactAngle,
    electron: collapsing && f.stage !== 'silence' ? orbit(f.angle, f.radius) : null,
    quiet: f.stage === 'silence' || f.stage === 'quiet' || f.stage === 'empty',
  };
}
export type EndingFrame = NonNullable<ReturnType<typeof endingFrame>>;

export function beyondFrame(game: Game, reducedMotion = false) {
  if (game.phase !== 'crossing') return null;
  const radius = game.rules.orbit.radius,
    t = Math.min(game.phaseTicks / game.rules.time.tickRate, game.rules.time.beyondSeconds);
  const contract = clamp((t - 0.2) / 0.55),
    trail = clamp((t - 1.6) / 0.65),
    expand = clamp((t - 0.9) / 1.5),
    ease = 1 - (1 - expand) ** 3,
    blend = clamp((t - 1.05) / 0.95);
  const channel = (shift: number) =>
    Math.round(
      ((BLUE >> shift) & 255) + (((VIOLET >> shift) & 255) - ((BLUE >> shift) & 255)) * blend,
    );
  return {
    stage:
      t < 0.2 ? 'depart' : t < 0.75 ? 'contract' : t < 0.9 ? 'quiet' : t < 1.45 ? 'open' : 'orbit',
    ring: reducedMotion ? radius : radius * ease,
    core: reducedMotion ? 0 : 24 * (1 - contract) ** 2,
    alpha: reducedMotion ? clamp((t - 0.9) / 0.6) : 1,
    electron: clamp((t - 1.05) / 0.4),
    angle: game.angle - (reducedMotion ? 0 : (1 - ease) * Math.PI),
    color: (channel(16) << 16) | (channel(8) << 8) | channel(0),
    opacity: 0.8 - 0.48 * clamp((t - 1.45) / 0.95),
    point: contract * (1 - clamp((t - 0.9) / 0.35)),
    trail: trail * trail * (3 - 2 * trail),
    dust: clamp(expand / 0.12) * (1 - expand) * 0.35,
    expand,
  };
}
