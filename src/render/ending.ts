import type { Game } from '../game/Game.ts';
import { clamp, orbit } from '../game/geometry.ts';

export type EndingStage =
  | 'accelerate'
  | 'compress'
  | 'silence'
  | 'formation'
  | 'settle'
  | 'quiet'
  | 'unstable'
  | 'spiral'
  | 'impact'
  | 'empty';

// Presentation only: combat has already stopped before this timeline begins.
export function endingFrame(game: Game) {
  if (!['collapse', 'ending', 'result'].includes(game.phase)) return null;
  const success = game.successfulEnding;
  const p = game.phase === 'result' ? 1 : clamp(game.phaseProgress);
  const collapsing = game.phase === 'collapse';
  let stage: EndingStage,
    radius = 0,
    angle = game.angle,
    absorb = 0,
    hole = 0,
    expansion = 0,
    reveal = 0,
    flash = 0,
    fracture = 0;
  const contactAngle = game.angle + Math.PI * 2.6;
  const contactRadius = Math.min(game.radius, game.core * 0.92);
  if (success && collapsing) {
    const q = clamp((p - 0.34) / 0.54);
    stage = p < 0.34 ? 'accelerate' : p < 0.88 ? 'compress' : 'silence';
    radius = game.radius * (1 - 0.06 * clamp(p / 0.34)) * (1 - q) ** 2;
    angle += Math.PI * (p < 0.34 ? 0.8 * (p / 0.34) ** 2 : 0.8 + q * 5.5);
    absorb = q * 0.7;
  } else if (success) {
    const t = p * game.rules.successEndingSeconds;
    stage = t < 0.4 ? 'formation' : t < 2.1 ? 'settle' : 'quiet';
    hole = t < 0.4 ? [2, 5, 10, 17, 24][Math.min(4, Math.floor(t / 0.08))] : 24;
    expansion = clamp((t - 0.4) / 1.6) ** 2;
    reveal = clamp((t - 2.35) / 0.65);
    absorb = 0.7 + 0.3 * clamp(t / 1.8);
    flash = t < 0.05 ? 1 - t / 0.05 : 0;
  } else if (collapsing) {
    const q = clamp((p - 0.25) / 0.75);
    stage = p < 0.25 ? 'unstable' : 'spiral';
    radius = game.radius + (contactRadius - game.radius) * q ** 1.5;
    angle += Math.PI * (p * 1.2 + q * q * 1.4);
    fracture = clamp((p - 0.15) / 0.25);
    absorb = clamp((p - 0.5) / 0.5);
  } else {
    const t = p * game.rules.failureEndingSeconds;
    stage = t < 0.2 ? 'impact' : 'empty';
    flash = 1 - clamp(t / 0.2);
    fracture = 1;
    absorb = 1;
  }
  return {
    stage,
    success,
    radius,
    angle,
    absorb,
    hole,
    expansion,
    reveal,
    flash,
    fracture,
    contact: success ? null : orbit(contactAngle, contactRadius),
    contactFrom: success ? null : orbit(contactAngle, game.radius + game.rules.electronRadius * 2),
    contactAngle,
    electron: collapsing && stage !== 'silence' ? orbit(angle, radius) : null,
    quiet: stage === 'silence' || stage === 'quiet' || stage === 'empty',
  };
}
