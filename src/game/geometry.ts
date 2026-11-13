export type Point = { x: number; y: number };
export const CENTER: Point = { x: 180, y: 260 };
export const TAU = Math.PI * 2;
export const goldenAngle = Math.PI * (3 - Math.sqrt(5));

export const orbit = (angle: number, radius: number): Point => ({
  x: CENTER.x + radius * Math.cos(angle),
  y: CENTER.y + radius * Math.sin(angle),
});
export const at = ({ x, y }: Point): Point => ({ x, y });
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (p: Point): Point => {
  const d = Math.hypot(p.x, p.y);
  return d < 1e-8 ? { x: 1, y: 0 } : { x: p.x / d, y: p.y / d };
};
export const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
// How far `angle` lies ahead of `from` going forward around the orbit, in [0, TAU).
export const ahead = (angle: number, from: number) => (((angle - from) % TAU) + TAU) % TAU;
