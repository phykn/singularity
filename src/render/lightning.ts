import type Phaser from 'phaser';
import { BLUE, WHITE, AMBER, skillColors } from './palette.ts';
import { effectOrigin } from './effects.ts';
import { rarityIds } from '../game/rules.ts';
import { lerp, clamp } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import type { Effect, Target } from '../game/types.ts';

type Graphics = Phaser.GameObjects.Graphics;

function stroke(
  g: Graphics,
  points: Point[],
  width: number,
  ink: number,
  alpha: number,
  scale: number,
) {
  g.lineStyle(width / scale, ink, alpha);
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.strokePath();
}

function bolt(from: Point, to: Point, seed: number, scale: number, reduced: boolean): Point[] {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const points = [from];
  for (let i = 1; i < 8; i++) {
    const shift = reduced ? 0 : Math.sin(seed + i * 11) * Math.min(6 / scale, length / 8);
    points.push({
      x: Math.round((lerp(from.x, to.x, i / 8) - (dy / length) * shift) * scale) / scale,
      y: Math.round((lerp(from.y, to.y, i / 8) + (dx / length) * shift) * scale) / scale,
    });
  }
  points.push(to);
  return points;
}

function spark(g: Graphics, point: Point, size: number, ink: number, alpha: number, scale: number) {
  const p = 1 / scale,
    x = Math.round(point.x * scale) / scale,
    y = Math.round(point.y * scale) / scale;
  g.fillStyle(ink, alpha * 0.65);
  g.fillRect(x - size * p, y - p, size * 2 * p, 2 * p);
  g.fillRect(x - p, y - size * p, 2 * p, size * 2 * p);
  g.fillStyle(WHITE, alpha);
  g.fillRect(x - p, y - p, 2 * p, 2 * p);
}

function arrow(g: Graphics, from: Point, to: Point, ink: number, alpha: number, scale: number) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  if (!length) return;
  const x = dx / length,
    y = dy / length,
    size = 4 / scale;
  stroke(
    g,
    [
      { x: to.x - (x + y) * size, y: to.y - (y - x) * size },
      to,
      { x: to.x - (x - y) * size, y: to.y - (y + x) * size },
    ],
    1,
    ink,
    alpha,
    scale,
  );
}

function lock(g: Graphics, point: Point, ink: number, alpha: number, scale: number) {
  const p = 1 / scale;
  g.lineStyle(p, ink, alpha);
  g.beginPath();
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      g.moveTo(point.x + x * 5 * p, point.y + y * 8 * p);
      g.lineTo(point.x + x * 8 * p, point.y + y * 8 * p);
      g.lineTo(point.x + x * 8 * p, point.y + y * 5 * p);
    }
  g.strokePath();
}

function ring(
  g: Graphics,
  from: Point,
  radius: number,
  ink: number,
  alpha: number,
  scale: number,
  reduced: boolean,
  width = 2,
) {
  if (radius <= 0) return;
  if (reduced) {
    g.lineStyle(width / scale, ink, alpha);
    g.strokeCircle(from.x, from.y, radius);
    return;
  }
  const points = [];
  for (let i = 0; i <= 40; i++) {
    const angle = (i * Math.PI * 2) / 40;
    const r = radius - (i % 2 ? Math.min(3 / scale, radius * 0.08) : 0);
    points.push({
      x: Math.round((from.x + Math.cos(angle) * r) * scale) / scale,
      y: Math.round((from.y + Math.sin(angle) * r) * scale) / scale,
    });
  }
  stroke(g, points, width, ink, alpha, scale);
}

export function drawEffect(
  g: Graphics,
  fx: Effect,
  time: number,
  scale: number,
  reduced: boolean,
  electron: Point,
  targets: Target[],
): void {
  const from = effectOrigin(fx, electron);
  const to =
    fx.kind === 'pierce'
      ? { x: from.x + fx.to.x - fx.from.x, y: from.y + fx.to.y - fx.from.y }
      : fx.kind === 'focus'
        ? (targets.find((target) => target.id === fx.targetId) ?? fx.to)
        : fx.to;
  const t = clamp((time - fx.born) / fx.life);
  if (t >= 1) return;
  const alpha = Math.pow(1 - t, 0.7);
  const ink = fx.source ? skillColors[fx.source] : BLUE;
  const strength = clamp(fx.rank / 5) + rarityIds.indexOf(fx.rarity) * 0.06;

  if (fx.kind === 'wave') {
    const radius = fx.radius * t;
    ring(g, from, radius, ink, 0.9, scale, reduced, 2 + Math.floor(strength * 2));
    if (!reduced) {
      ring(g, from, Math.max(0, radius - 4 / scale), ink, 0.3, scale, true, 1);
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        arrow(
          g,
          from,
          { x: from.x + Math.cos(angle) * radius, y: from.y + Math.sin(angle) * radius },
          WHITE,
          0.8,
          scale,
        );
      }
    }
  } else if (fx.kind === 'whip') {
    const start = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x);
    const angle = start + fx.width * t;
    const end = {
      x: from.x + Math.cos(angle) * fx.radius,
      y: from.y + Math.sin(angle) * fx.radius,
    };
    if (!reduced) {
      const arc = [];
      for (let i = 0; i <= 16; i++) {
        const a = start + (fx.width * t * i) / 16;
        arc.push({ x: from.x + Math.cos(a) * fx.radius, y: from.y + Math.sin(a) * fx.radius });
      }
      g.fillStyle(ink, 0.045);
      g.beginPath();
      g.moveTo(from.x, from.y);
      for (const point of arc) g.lineTo(point.x, point.y);
      g.closePath();
      g.fillPath();
      stroke(g, arc, 1, ink, 0.3, scale);
      spark(g, end, 3 + Math.floor(strength * 2), ink, 0.9, scale);
    }
    const points = bolt(from, end, fx.born * 100, scale, reduced);
    stroke(g, points, 5 + Math.floor(strength * 2), ink, 0.25, scale);
    stroke(g, points, 2, ink, 0.95, scale);
    stroke(g, points, 1, WHITE, 0.9, scale);
  } else if (fx.kind === 'bolt' || fx.kind === 'strike' || fx.kind === 'focus') {
    const seed = from.x * 3 + to.y * 7 + fx.born * 100;
    const points =
      fx.kind === 'focus'
        ? [from, to]
        : fx.kind === 'strike'
          ? [
              from,
              { x: to.x - 5 / scale, y: lerp(from.y, to.y, 0.32) },
              { x: to.x + 5 / scale, y: lerp(from.y, to.y, 0.32) },
              { x: to.x - 5 / scale, y: lerp(from.y, to.y, 0.68) },
              { x: to.x + 5 / scale, y: lerp(from.y, to.y, 0.68) },
              to,
            ]
          : bolt(from, to, seed, scale, reduced);
    const opacity = fx.kind === 'focus' ? 1 : alpha;
    const width = Math.min(2, Math.max(1, fx.width / 1.8));
    stroke(g, points, (5 + Math.floor(strength * 2)) * width, ink, 0.2 * opacity, scale);
    stroke(g, points, 2 * width, ink, 0.85 * opacity, scale);
    stroke(g, points, 1 * width, WHITE, opacity, scale);
    if (fx.kind === 'focus') lock(g, to, ink, 0.9, scale);
    if (fx.source === 'repeat') {
      const dx = to.x - from.x,
        dy = to.y - from.y,
        length = Math.hypot(dx, dy) || 1;
      const line = reduced
        ? [from, { x: lerp(from.x, to.x, 0.5), y: lerp(from.y, to.y, 0.5) }, to]
        : points;
      const echo = line.map((point, i) => {
        const offset = i && i < line.length - 1 ? 3 / scale : 0;
        return { x: point.x - (dy / length) * offset, y: point.y + (dx / length) * offset };
      });
      stroke(g, echo, 1, ink, 0.75 * opacity, scale);
    }
    if (!reduced) {
      if (fx.kind === 'focus') {
        const braid = bolt(from, to, seed + 4, scale, false);
        stroke(g, braid, 1, ink, 0.7, scale);
      } else if (fx.kind !== 'strike') {
        spark(g, to, 2 + Math.floor(strength * 3), ink, opacity, scale);
        if (fx.source === 'chain') {
          const pulse = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
          arrow(g, from, pulse, WHITE, opacity, scale);
          g.fillStyle(ink, opacity);
          g.fillRect(from.x - 2 / scale, from.y - 2 / scale, 4 / scale, 4 / scale);
        } else if (fx.source === 'burst') {
          g.lineStyle(1 / scale, WHITE, opacity);
          const p = 3 / scale;
          g.lineBetween(from.x - p, from.y - p, from.x + p, from.y + p);
          g.lineBetween(from.x - p, from.y + p, from.x + p, from.y - p);
        }
      }
    }
    if (fx.kind === 'strike') {
      ring(g, to, fx.radius, ink, alpha * 0.9, scale, reduced, 2);
      g.fillStyle(ink, 0.12 * alpha);
      g.fillCircle(to.x, to.y, fx.radius);
      if (!reduced) spark(g, to, 5 + Math.floor(strength * 3), ink, alpha, scale);
    }
  } else if (fx.kind === 'pierce') {
    const points = [from, to];
    stroke(g, points, fx.width * scale, ink, 0.13 * alpha, scale);
    stroke(g, points, 3 + Math.floor(strength * 2), ink, 0.55 * alpha, scale);
    stroke(g, points, 1, WHITE, alpha, scale);
    if (!reduced) {
      const dx = to.x - from.x,
        dy = to.y - from.y,
        length = Math.hypot(dx, dy) || 1;
      for (const side of [-1, 1]) {
        const x = (-dy / length) * fx.width * 0.5 * side,
          y = (dx / length) * fx.width * 0.5 * side;
        stroke(
          g,
          [
            { x: from.x + x, y: from.y + y },
            { x: to.x + x, y: to.y + y },
          ],
          1,
          ink,
          0.55 * alpha,
          scale,
        );
      }
      arrow(g, from, to, WHITE, alpha, scale);
    }
  } else if (fx.kind === 'area') {
    const radius = fx.radius;
    g.fillStyle(ink, alpha * 0.025);
    g.fillCircle(from.x, from.y, radius);
    ring(g, from, radius, ink, alpha * 0.5, scale, reduced, 1);
    if (!reduced) {
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2 + fx.born;
        const to = {
          x: from.x + Math.cos(angle) * radius * 0.75,
          y: from.y + Math.sin(angle) * radius * 0.75,
        };
        stroke(g, bolt(from, to, i + fx.born * 100, scale, false), 1, ink, alpha * 0.45, scale);
      }
      spark(g, from, 3, ink, alpha, scale);
    }
  } else if (fx.kind === 'upgrade') {
    const radius = (9 + t * (16 + strength * 8)) / scale;
    ring(g, from, radius, ink, alpha * 0.85, scale, reduced, 2);
    if (!reduced) {
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        spark(
          g,
          { x: from.x + Math.cos(angle) * radius, y: from.y + Math.sin(angle) * radius },
          2,
          ink,
          alpha,
          scale,
        );
      }
    }
  } else if (fx.kind === 'absorb') {
    const x = lerp(from.x, 180, Math.min(1, t * 2)),
      y = lerp(from.y, 260, Math.min(1, t * 2));
    g.fillStyle(AMBER, alpha);
    g.fillRect(x - 2 / scale, y - 2 / scale, 4 / scale, 4 / scale);
    g.lineStyle(1 / scale, AMBER, alpha * 0.7);
    g.strokeCircle(180, 260, fx.radius * (1.25 - t * 0.5));
  } else if (fx.kind === 'kill') {
    g.fillStyle(ink, alpha);
    const x = lerp(from.x, to.x, t * t),
      y = lerp(from.y, to.y, t * t);
    g.fillCircle(x, y, 2 / scale);
    if (!reduced) {
      g.lineStyle(1.2 / scale, ink, alpha * 0.5);
      g.strokeCircle(from.x, from.y, (4 + t * 17) / scale);
      spark(g, from, 4 * (1 - t), ink, alpha * 0.8, scale);
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 + fx.born * 7,
          radius = (5 + t * 24) / scale;
        g.lineStyle(0.7 / scale, i % 2 ? WHITE : ink, alpha);
        g.lineBetween(
          from.x + Math.cos(angle) * radius,
          from.y + Math.sin(angle) * radius,
          from.x + Math.cos(angle) * (radius + 4 / scale),
          from.y + Math.sin(angle) * (radius + 4 / scale),
        );
      }
    }
  } else {
    ring(g, from, fx.radius * (0.25 + 0.75 * t), ink, alpha * 0.6, scale, reduced, 1);
  }
}
