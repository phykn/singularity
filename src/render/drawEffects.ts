import type Phaser from 'phaser';
import { BLUE, WHITE, AMBER, skillColors } from '../art/palette.ts';
import { effectOrigin } from './effects.ts';
import type { BeamStamp, EffectStamp } from './effects.ts';
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
  stamp: EffectStamp,
  beam: BeamStamp,
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
  const clock = time + fx.born * 3;
  if (fx.kind === 'bridge') {
    beam('bridge', from, to, clock, ink, 0.6, 16);
    g.fillStyle(WHITE, 0.65);
    const phase = (time * 1.5) % 1;
    g.fillRect(lerp(from.x, to.x, phase), lerp(from.y, to.y, phase), 2 / scale, 2 / scale);
  } else if (fx.kind === 'charge' || fx.kind === 'stun') {
    const point = targets.find((target) => target.id === fx.targetId) ?? from;
    if (fx.kind === 'charge') {
      stamp('charge', point, time, ink, alpha * (0.3 + clamp(fx.width) * 0.6));
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
    stamp('surge', from, time, ink, 0.9);
  } else if (fx.kind === 'return') {
    beam('return', from, to, clock, ink, alpha * 0.9, 16);
    const point = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
    g.fillStyle(WHITE, alpha);
    g.fillRect(point.x - 1 / scale, point.y - 1 / scale, 2 / scale, 2 / scale);
  } else if (fx.kind === 'bolt' || fx.kind === 'strike' || fx.kind === 'focus') {
    const opacity = fx.kind === 'focus' ? 1 : alpha;
    const id =
      fx.kind === 'strike'
        ? 'strike'
        : fx.kind === 'focus'
          ? 'focus'
          : fx.source === 'charge'
            ? 'charge'
            : fx.source === 'repel'
              ? 'pierce'
              : ['chain', 'burst', 'gather'].includes(fx.source ?? '')
                ? 'chain'
                : 'basic';
    const height = id === 'strike' || id === 'charge' ? 20 : 16;
    beam(id, from, to, clock, ink, 0.9 * opacity, height + Math.floor(strength));
    if (fx.source === 'repel') arrow(g, { x: 180, y: 260 }, to, ink, alpha, scale);
    if (fx.kind !== 'focus' && fx.kind !== 'strike') {
      stamp(fx.source === 'charge' ? 'impact' : 'hit', to, t, ink, opacity);
    }
    if (fx.kind === 'strike') {
      stamp('impact', to, t, ink, alpha);
    }
  } else if (fx.kind === 'pierce') {
    beam('pierce', from, to, clock, ink, 0.85 * alpha, 16 + Math.floor(strength * 2));
  } else if (fx.kind === 'upgrade') {
    if (fx.source === 'range') {
      ring(g, from, fx.radius, ink, alpha * 0.22, scale, 1);
      return;
    }
    if (fx.source === 'recover') {
      ring(g, from, fx.radius * (1 + t * 0.6), ink, alpha * 0.65, scale, 1);
      return;
    }
    const radius = (9 + t * (16 + strength * 8)) / scale;
    ring(g, from, radius, ink, alpha * 0.65, scale, 1);
  } else if (fx.kind === 'absorb') {
    const x = lerp(from.x, 180, Math.min(1, t * 2)),
      y = lerp(from.y, 260, Math.min(1, t * 2));
    g.fillStyle(AMBER, alpha);
    g.fillRect(x - 1 / scale, y - 1 / scale, 2 / scale, 2 / scale);
  } else if (fx.kind === 'kill') {
    stamp('dissolve', from, t, fx.radius > 8 ? WHITE : BLUE, (1 - t) ** 2);
  } else {
    ring(g, from, fx.radius * (0.25 + 0.75 * t), ink, alpha * 0.6, scale, 1);
  }
}
