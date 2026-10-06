import type { Point } from './geometry.ts';
import type { Target } from './types.ts';

export function closest(
  targets: Target[],
  point: Point,
  count = 1,
  range = Infinity,
  visited?: Set<number>,
): Target[] {
  const found: { target: Target; distance: number }[] = [];
  for (const target of targets) {
    if (target.hp <= 0 || visited?.has(target.id)) continue;
    const dx = target.x - point.x,
      dy = target.y - point.y;
    if (Math.abs(dx) > range || Math.abs(dy) > range) continue;
    const distance = Math.hypot(dx, dy);
    if (distance > range) continue;
    let i = found.length;
    while (
      i > 0 &&
      (distance < found[i - 1].distance ||
        (distance === found[i - 1].distance && target.id < found[i - 1].target.id))
    )
      i--;
    if (i >= count) continue;
    found.splice(i, 0, { target, distance });
    if (found.length > count) found.pop();
  }
  return found.map((entry) => entry.target);
}

export function onSegment(targets: Target[], from: Point, to: Point, width: number): Target[] {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  if (length < 0.001) return [];
  const hits: { target: Target; along: number }[] = [];
  for (const target of targets) {
    if (target.hp <= 0) continue;
    const x = target.x - from.x,
      y = target.y - from.y;
    const along = (x * dx + y * dy) / length;
    if (along >= 0 && along <= length && Math.abs(x * dy - y * dx) / length <= width / 2)
      hits.push({ target, along });
  }
  hits.sort((a, b) => a.along - b.along || a.target.id - b.target.id);
  return hits.map((entry) => entry.target);
}
