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
  g.lineStyle(Math.max(1, Math.round(width)) / scale, ink, alpha);
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.strokePath();
}
function bolt(from: Point, to: Point, seed: number, scale: number): Point[] {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const points = [from];
  const segments = Math.max(2, Math.min(7, Math.ceil((length * scale) / 24)));
  for (let i = 1; i < segments; i++) {
    const shift = Math.sin(seed + i * 11) * Math.min(4 / scale, length / 10);
    points.push({
      x: Math.round((lerp(from.x, to.x, i / segments) - (dy / length) * shift) * scale) / scale,
      y: Math.round((lerp(from.y, to.y, i / segments) + (dx / length) * shift) * scale) / scale,
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
function ring(
  g: Graphics,
  from: Point,
  radius: number,
  ink: number,
  alpha: number,
  scale: number,
  width = 2,
) {
  if (radius <= 0) return;
  const points = [];
  for (let i = 0; i <= 40; i++) {
    const angle = (i * Math.PI * 2) / 40;
    points.push({
      x: Math.round((from.x + Math.cos(angle) * radius) * scale) / scale,
      y: Math.round((from.y + Math.sin(angle) * radius) * scale) / scale,
    });
  }
  stroke(g, points, width, ink, alpha, scale);
}
export function drawEffect(
  g: Graphics,
  fx: Effect,
  time: number,
  scale: number,
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
  if (fx.kind === 'bridge') {
    stroke(g, bolt(from, to, fx.targetId ?? 0, scale), 1, ink, 0.6, scale);
    g.fillStyle(WHITE, 0.75);
    for (const point of [from, to])
      g.fillRect(point.x - 1 / scale, point.y - 1 / scale, 2 / scale, 2 / scale);
    const phase = (time * 1.5) % 1;
    g.fillRect(lerp(from.x, to.x, phase), lerp(from.y, to.y, phase), 2 / scale, 2 / scale);
  } else if (fx.kind === 'charge' || fx.kind === 'stun') {
    const point = targets.find((target) => target.id === fx.targetId) ?? from;
    if (fx.kind === 'charge') {
      const count = Math.max(1, Math.ceil(fx.width * 3));
      g.fillStyle(ink, alpha * 0.85);
      for (let i = 0; i < count; i++)
        g.fillRect(
          point.x + fx.radius,
          point.y - 3 / scale + (i * 3) / scale,
          2 / scale,
          2 / scale,
        );
    } else {
      g.lineStyle(1 / scale, ink, alpha);
      for (const side of [-1, 1])
        g.lineBetween(
          point.x + side * fx.radius,
          point.y - 2 / scale,
          point.x + side * (fx.radius + 2 / scale),
          point.y + 2 / scale,
        );
    }
  } else if (fx.kind === 'surge') {
    drawSurge(g, from, time, scale);
  } else if (fx.kind === 'return') {
    const points = bolt(from, to, fx.born * 10, scale);
    stroke(g, points, 3, ink, alpha * 0.2, scale);
    stroke(g, points, 1, ink, alpha * 0.9, scale);
    const point = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
    g.fillStyle(WHITE, alpha);
    g.fillRect(point.x - 1 / scale, point.y - 1 / scale, 2 / scale, 2 / scale);
  } else if (fx.kind === 'bolt' || fx.kind === 'strike' || fx.kind === 'focus') {
    const seed = from.x * 3 + to.y * 7 + fx.born * 100;
    const points = fx.kind === 'focus' ? [from, to] : bolt(from, to, seed, scale);
    const opacity = fx.kind === 'focus' ? 1 : alpha;
    const width = fx.kind === 'strike' ? 3 : 2;
    stroke(g, points, width + 2, ink, 0.12 * opacity, scale);
    stroke(g, points, width, ink, 0.8 * opacity, scale);
    stroke(g, points, 1, WHITE, 0.8 * opacity, scale);
    if (fx.source === 'repel') arrow(g, { x: 180, y: 260 }, to, ink, alpha, scale);
    if (fx.source === 'repeat') {
      const dx = to.x - from.x,
        dy = to.y - from.y,
        length = Math.hypot(dx, dy) || 1;
      const line = points;
      const echo = line.map((point, i) => {
        const offset = i && i < line.length - 1 ? 3 / scale : 0;
        return { x: point.x - (dy / length) * offset, y: point.y + (dx / length) * offset };
      });
      stroke(g, echo, 1, ink, 0.75 * opacity, scale);
    }
    if (fx.kind === 'focus') {
      const braid = bolt(from, to, seed + 4, scale);
      stroke(g, braid, 1, ink, 0.7, scale);
    } else if (fx.kind !== 'strike') {
      spark(g, to, 2 + Math.floor(strength), ink, opacity, scale);
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
    if (fx.kind === 'strike') {
      spark(g, to, 4 + Math.floor(strength * 2), ink, alpha, scale);
    }
  } else if (fx.kind === 'pierce') {
    const points = [from, to];
    stroke(g, points, fx.width * scale, ink, 0.08 * alpha, scale);
    stroke(g, points, 2 + Math.floor(strength), ink, 0.7 * alpha, scale);
    stroke(g, points, 1, WHITE, alpha, scale);
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
  } else if (fx.kind === 'upgrade') {
    if (fx.source === 'range') {
      ring(g, from, fx.radius, ink, alpha * 0.22, scale, 1);
      return;
    }
    if (fx.source === 'recover') {
      ring(g, from, fx.radius * (1 + t * 0.6), ink, alpha * 0.65, scale, 1);
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 + fx.born;
        const x = Math.round((from.x + Math.cos(angle) * fx.radius * (0.5 + t)) * scale) / scale;
        const y = Math.round((from.y + Math.sin(angle) * fx.radius * (0.5 + t)) * scale) / scale;
        g.fillStyle(ink, alpha * 0.7);
        g.fillRect(x, y, 2 / scale, 2 / scale);
      }
      return;
    }
    const radius = (9 + t * (16 + strength * 8)) / scale;
    ring(g, from, radius, ink, alpha * 0.85, scale, 2);
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
  } else if (fx.kind === 'absorb') {
    const x = lerp(from.x, 180, Math.min(1, t * 2)),
      y = lerp(from.y, 260, Math.min(1, t * 2));
    g.fillStyle(AMBER, alpha);
    g.fillRect(x - 2 / scale, y - 2 / scale, 4 / scale, 4 / scale);
    g.lineStyle(1 / scale, AMBER, alpha * 0.7);
    g.strokeCircle(180, 260, fx.radius * (1.25 - t * 0.5));
  } else if (fx.kind === 'kill') {
    const heavy = fx.radius > 8,
      size = heavy ? 1.5 : 1;
    const fade = (1 - t) ** 2;
    spark(g, from, (t < 0.12 ? 3 : 1) * size, WHITE, fade, scale);
    ring(g, from, ((3 + t * 6) * size) / scale, BLUE, fade * 0.35, scale, 1);
    const count = heavy ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count + fx.from.x + fx.born * 7;
      const distance = (2 + t * 12) * size;
      const x = Math.round(from.x * scale + Math.cos(angle) * distance) / scale;
      const y = Math.round(from.y * scale + Math.sin(angle) * distance) / scale;
      const pixel = (heavy && i % 2 === 0 ? 2 : 1) / scale;
      g.fillStyle(i % 2 ? BLUE : WHITE, fade);
      g.fillRect(x, y, pixel, pixel);
    }
  } else {
    ring(g, from, fx.radius * (0.25 + 0.75 * t), ink, alpha * 0.6, scale, 1);
  }
}
export function drawOrb(g: Graphics, point: Point, scale: number): void {
  const ink = skillColors.orb,
    p = 1 / scale,
    x = Math.round(point.x * scale) / scale,
    y = Math.round(point.y * scale) / scale;
  g.fillStyle(ink, 0.3);
  g.fillRect(x - 4 * p, y - 2 * p, 8 * p, 4 * p);
  g.fillRect(x - 2 * p, y - 4 * p, 4 * p, 8 * p);
  g.fillStyle(ink, 0.95);
  g.fillRect(x - 3 * p, y - 2 * p, 6 * p, 4 * p);
  g.fillRect(x - 2 * p, y - 3 * p, 4 * p, 6 * p);
  g.fillStyle(WHITE, 0.95);
  g.fillRect(x - p, y - p, 2 * p, 2 * p);
}

export function drawSurge(g: Graphics, point: Point, time: number, scale: number): void {
  const ink = skillColors.surge;
  // Keep the aura steady and readable; only the local electric arcs rotate.
  g.fillStyle(ink, 0.09);
  g.fillCircle(point.x, point.y, 17 / scale);
  g.fillStyle(ink, 0.16);
  g.fillCircle(point.x, point.y, 11 / scale);
  for (let i = 0; i < 3; i++) {
    const points: Point[] = [];
    const start = (i * Math.PI * 2) / 3 + time * 3;
    for (let j = 0; j < 5; j++) {
      const angle = start + j * 0.22;
      const radius = (j % 2 ? 13 : 11) / scale;
      points.push({
        x: Math.round((point.x + Math.cos(angle) * radius) * scale) / scale,
        y: Math.round((point.y + Math.sin(angle) * radius) * scale) / scale,
      });
    }
    stroke(g, points, 4, ink, 0.18, scale);
    stroke(g, points, 2, ink, 0.95, scale);
    stroke(g, points, 1, WHITE, 0.8, scale);
  }
}
