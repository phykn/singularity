import type { Target } from '../game/types.ts';
import { particleFrames } from './particleAtlas.ts';

export function healthBar(target: Target, damage: number) {
  if (target.hp <= 0 || target.maxHp <= damage + 1e-8) return null;
  const size = particleFrames[target.particle].size;
  const width = Math.max(14, size);
  return {
    width,
    height: 2,
    offset: Math.ceil(size / 2) + 5,
    filled: Math.max(1, Math.round(width * Math.min(1, target.hp / target.maxHp))),
  };
}
