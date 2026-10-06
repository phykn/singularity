import type { Target } from '../game/types.ts';
import { particleArt } from '../art/particles.ts';

export function healthBar(target: Target, damage: number) {
  if (target.hp <= 0 || target.maxHp <= damage + 1e-8) return null;
  const width = Math.max(14, particleArt[target.particle][0].length);
  return {
    width,
    height: 2,
    offset: Math.ceil(particleArt[target.particle].length / 2) + 5,
    filled: Math.max(1, Math.round(width * Math.min(1, target.hp / target.maxHp))),
  };
}
