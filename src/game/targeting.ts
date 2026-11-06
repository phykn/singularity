import type { Point } from './geometry.ts';
import type { Target } from './types.ts';

// The nearest live targets within `range`, ties broken by id.
export function closest(
  targets: readonly Target[],
  point: Point,
  count = 1,
  range = Infinity,
  skip?: Set<number>,
): Target[] {
  const found: { target: Target; d: number }[] = [];
  let limit = range;
  for (const target of targets) {
    if (target.hp <= 0 || skip?.has(target.id)) continue;
    const dx = target.x - point.x,
      dy = target.y - point.y;
    if (Math.abs(dx) > limit || Math.abs(dy) > limit) continue;
    const d = Math.hypot(dx, dy);
    if (d > limit) continue;
    let i = found.length;
    while (
      i > 0 &&
      (d < found[i - 1].d || (d === found[i - 1].d && target.id < found[i - 1].target.id))
    )
      i--;
    if (i >= count) continue;
    found.splice(i, 0, { target, d });
    if (found.length > count) found.pop();
    if (found.length === count) limit = found[count - 1].d;
  }
  return found.map((entry) => entry.target);
}

// Live targets within `width` of the segment, ordered from `from`.
export function onSegment(
  targets: readonly Target[],
  from: Point,
  to: Point,
  width: number,
): Target[] {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  if (length < 0.001) return [];
  const hits: { target: Target; along: number }[] = [];
  for (const target of targets) {
    if (target.hp <= 0) continue;
    const x = target.x - from.x,
      y = target.y - from.y,
      along = (x * dx + y * dy) / length;
    if (along >= 0 && along <= length && Math.abs(x * dy - y * dx) / length <= width / 2)
      hits.push({ target, along });
  }
  return hits.sort((a, b) => a.along - b.along || a.target.id - b.target.id).map((h) => h.target);
}
