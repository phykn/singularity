import type { Combat } from './combat.ts';
import type { SkillId } from './rules.ts';
import { closest } from './targeting.ts';
import type { Beat } from './types.ts';

// An accepted beat strikes the nearest particle; the third strikes every particle once.
// Tempo Coil and the Pulse pact then sweep forward along the orbit, popping in order.
export function strikeBeat(combat: Combat, beat: Exclude<Beat, 0>): void {
  const g = combat.game,
    cfg = g.rules.combat.resonance,
    multiplier = beat === 3 ? cfg.finishDamage : cfg.beatDamage,
    attack = combat.begin(undefined, multiplier);
  attack.power *= multiplier;
  if (beat === 3) {
    // One global hit per particle; link cascades stay on the first two beats.
    attack.depth = 2;
    for (const target of [...g.targets]) combat.deal(attack, target, attack.damage);
  } else combat.volley(attack, g.position, closest(g.targets, g.position, 1, attack.range), true);
  const { ranks, values, evolved, pacts } = g.growth,
    tempo = g.rules.skills.tempo,
    pulse = g.rules.pacts.pulse;
  if (ranks.tempo) {
    // Evolved: the third beat sweeps the whole lap, a little softer per particle.
    const whole = beat === 3 && evolved.tempo,
      count = whole ? Infinity : values.tempo.count * (beat === 3 ? tempo.finishScale : 1),
      damage = whole ? values.tempo.damage * tempo.evolution.damage : values.tempo.damage;
    if (sweep(combat, 'tempo', values.tempo.band, count, damage)) combat.activate('tempo');
  }
  if (pacts.pulse) sweep(combat, undefined, values.tempo.band || 24, pulse.count, pulse.damage);
}

function sweep(
  combat: Combat,
  source: SkillId | undefined,
  band: number,
  count: number,
  damage: number,
): boolean {
  const g = combat.game,
    targets = combat.alongOrbit((t) => t.radius <= g.radius + band).slice(0, count);
  if (!targets.length) return false;
  const attack = { ...combat.begin(source, damage), depth: 2 };
  combat.popInOrder(attack, g.position, targets, g.rules.skills.tempo.popSeconds);
  return true;
}
