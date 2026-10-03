import { rules } from './rules.ts';

export type Point = { x: number; y: number };
export const CENTER = { x: 180, y: 260 };
export const orbitRadius = rules.orbitRadius;
export const orbit = (angle: number, radius = orbitRadius): Point => ({ x: CENTER.x + radius * Math.cos(angle), y: CENTER.y + radius * Math.sin(angle) });
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (p: Point): Point => { const d = Math.hypot(p.x, p.y); return { x: p.x / d, y: p.y / d }; };

export const satellitePosition = (point: Point, index: number, count: number, time: number): Point => {
  const angle = time * 2 + index * Math.PI * 2 / count;
  return { x: point.x + Math.cos(angle) * 15, y: point.y + Math.sin(angle) * 15 };
};
