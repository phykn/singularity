import Phaser from 'phaser';
import { BLUE, WHITE, AMBER } from './palette.ts';
import { effectOrigin } from './effects.ts';
import { lerp, clamp } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import type { Effect, Target } from '../game/types.ts';

export function drawEffect(
  g: Phaser.GameObjects.Graphics,
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
  const alpha = Math.pow(1 - t, 0.7),
    ink = BLUE;
  if (fx.kind === 'wave') {
    g.lineStyle(2 / scale, ink, 0.8);
    g.strokeCircle(from.x, from.y, fx.radius * t);
    if (!reduced) {
      g.lineStyle(1 / scale, WHITE, 0.65);
      g.strokeCircle(from.x, from.y, Math.max(0, fx.radius * t - 3 / scale));
    }
  } else if (fx.kind === 'whip') {
    const start = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x),
      angle = start + fx.width * t;
    const end = {
      x: from.x + Math.cos(angle) * fx.radius,
      y: from.y + Math.sin(angle) * fx.radius,
    };
    g.lineStyle(2 / scale, WHITE, 0.95);
    g.beginPath();
    g.moveTo(from.x, from.y);
    for (let i = 1; i <= 8; i++) {
      const offset = i % 2 && !reduced ? 3 : 0;
      g.lineTo(
        lerp(from.x, end.x, i / 8) + Math.sin(angle) * offset,
        lerp(from.y, end.y, i / 8) - Math.cos(angle) * offset,
      );
    }
    g.strokePath();
    g.lineStyle(1 / scale, ink, 0.45);
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const a = start + (fx.width * t * i) / 16;
      const x = from.x + Math.cos(a) * fx.radius,
        y = from.y + Math.sin(a) * fx.radius;
      if (!i) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  } else if (fx.kind === 'bolt' || fx.kind === 'strike' || fx.kind === 'focus') {
    const points = [from];
    for (let i = 1; i < 6; i++) {
      const shift = reduced ? 0 : Math.sin(from.x * 3 + to.y * 7 + i * 11 + fx.born * 100) * 5;
      points.push({ x: lerp(from.x, to.x, i / 6) + shift, y: lerp(from.y, to.y, i / 6) - shift });
    }
    points.push(to);
    for (const [width, opacity] of [
      [4, 0.16],
      [2, 0.6],
      [1, 1],
    ]) {
      g.lineStyle(
        (width * Math.min(2, Math.max(1, fx.width / 1.8))) / scale,
        width === 1 ? WHITE : ink,
        opacity * (fx.kind === 'focus' ? 1 : alpha),
      );
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((p) => g.lineTo(p.x, p.y));
      g.strokePath();
    }
    if (fx.kind === 'strike') {
      g.lineStyle(1 / scale, WHITE, alpha);
      g.strokeCircle(to.x, to.y, fx.radius);
      g.fillStyle(ink, 0.12 * alpha);
      g.fillCircle(to.x, to.y, fx.radius);
    }
  } else if (fx.kind === 'pierce') {
    g.lineStyle(fx.width, ink, 0.13 * alpha);
    g.lineBetween(from.x, from.y, to.x, to.y);
    g.lineStyle(1.8 / scale, WHITE, alpha);
    g.lineBetween(from.x, from.y, to.x, to.y);
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
      g.fillStyle(WHITE, alpha * 0.8);
      g.fillCircle(from.x, from.y, ((1 - t) * 4) / scale);
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 + fx.born * 7;
        const radius = (5 + t * 24) / scale;
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
    const radius = fx.radius * (0.25 + 0.75 * t);
    g.fillStyle(ink, alpha * 0.035);
    g.fillCircle(from.x, from.y, radius);
    g.lineStyle(0.7 / scale, ink, alpha * (fx.kind === 'area' ? 0.16 : 0.45));
    g.strokeCircle(from.x, from.y, radius);
  }
}
