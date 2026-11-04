import { particleMotion } from '../game/particles.ts';
import type { Game } from '../game/Game.ts';
import type { Target } from '../game/types.ts';

// How a particle's own rule shows on its sprite: muons blink before a dash and face the
// core, mesons spin, veiled neutrinos stay faint, and a Z boson fades while immune.
export function particleLook(game: Game, target: Target, clock: number) {
  const age = game.time - target.born;
  let alpha = 1,
    rotation = 0;
  if (target.particle === 'muon' && target.kind !== 'boss') {
    rotation = target.angle;
    if (particleMotion('muon', age).charging) alpha = Math.sin(clock * 40) > 0 ? 1 : 0.35;
  } else if (target.particle === 'meson') rotation = age * 6;
  // The tau's nose points the way it charges.
  if (target.boss === 'tau') rotation = target.angle + Math.PI;
  if (target.veiled) alpha = 0.3;
  const boss = game.bossPhase(target);
  if (boss?.immune) alpha = 0.3;
  else if (boss?.warning || boss?.charging) alpha = Math.sin(clock * 30) > 0 ? 1 : 0.45;
  return { alpha, rotation };
}
