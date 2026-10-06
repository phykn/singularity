import type { Target } from '../game/types.ts';

export function healthBar(target: Target, damage: number) {
  if (target.hp <= 0 || target.maxHp <= damage + 1e-8) return null;
  const width = 12;
  return {
    width,
    height: 1,
    offset: 10,
    filled: Math.max(1, Math.round(width * Math.min(1, target.hp / target.maxHp))),
  };
}
