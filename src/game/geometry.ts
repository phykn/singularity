import { rules } from './rules.ts';

export type Point = { x: number; y: number };
export const CENTER = { x: 180, y: 260 };
export const orbitRadius = rules.orbitRadius;
export const orbit = (angle: number, radius = orbitRadius): Point => ({
  x: CENTER.x + radius * Math.cos(angle),
  y: CENTER.y + radius * Math.sin(angle),
});
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (p: Point): Point => {
  const d = Math.hypot(p.x, p.y);
  return { x: p.x / d, y: p.y / d };
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
