import type Phaser from 'phaser';
import { BLUE, WHITE, AMBER, skillColors } from '../art/palette.ts';
import { beamStrength, effectOrigin } from './effects.ts';
import type { EffectPainter } from './effects.ts';
import { rarityIds } from '../game/rules.ts';
import { lerp, clamp, orbit } from '../game/geometry.ts';
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
  paint: EffectPainter,
  orbitRadius = fx.radius,
  satellites: readonly Point[] = [],
): void {
  const from = effectOrigin(fx, electron, satellites);
  const to =
    typeof fx.endAnchor === 'number'
      ? (satellites[fx.endAnchor] ?? fx.to)
      : fx.endAnchor === 'electron'
        ? electron
        : fx.kind === 'pierce'
          ? { x: from.x + fx.to.x - fx.from.x, y: from.y + fx.to.y - fx.from.y }
          : fx.kind === 'focus'
            ? (targets.find((target) => target.id === fx.targetId) ?? fx.to)
            : fx.to;
  const t = clamp((time - fx.born) / fx.life);
  if (t >= 1) return;
  const alpha = Math.pow(1 - t, 0.7);
  const ink = fx.source ? skillColors[fx.source] : BLUE;
  const strength = clamp(fx.rank / 5) + rarityIds.indexOf(fx.rarity) * 0.06;
  const rank = Math.max(1, Math.min(5, fx.rank));
  const power = beamStrength(fx.damage);
  const light = 0.7 + 0.22 * (fx.damage / (fx.damage + 10));
  const impactSize = 20 + power * 4;
  const clock = time + fx.born * 3;
  if (fx.kind === 'bridge') {
    if (!fx.arc || fx.arc.sweep <= 0) return;
    const steps = Math.max(1, Math.ceil(fx.arc.sweep / 0.15));
    for (let i = 0; i < steps; i++) {
      const start = fx.arc.start + (fx.arc.sweep * i) / steps;
      const end = fx.arc.start + (fx.arc.sweep * (i + 1)) / steps;
      paint.beam(
        'bridge',
        orbit(start, orbitRadius),
        orbit(end, orbitRadius),
        clock + i * 0.07,
        ink,
        light,
        16,
        power,
      );
    }
    for (const edge of [fx.arc.start, fx.arc.start + fx.arc.sweep]) {
      stroke(
        g,
        [orbit(edge, orbitRadius - 2 / scale), orbit(edge, orbitRadius + 2 / scale)],
        1,
        WHITE,
        0.85,
        scale,
      );
    }
    const point = orbit(fx.arc.start + fx.arc.sweep * ((time * 1.5) % 1), orbitRadius);
    g.fillStyle(WHITE, 0.7);
    g.fillRect(point.x - 1 / scale, point.y - 1 / scale, 2 / scale, 2 / scale);
  } else if (fx.kind === 'vent') {
    // A few outward motes make mass loss visible without a persistent core border.
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 + [0, 0.09, -0.06, 0.04, -0.1, 0.08][i] + fx.born;
      const radius = fx.radius * (0.5 + t) * (i % 2 ? 0.9 : 1);
      g.fillStyle(i % 2 ? WHITE : ink, alpha * 0.85);
      g.fillRect(
        from.x + Math.cos(angle) * radius,
        from.y + Math.sin(angle) * radius,
        (1 + Math.ceil(rank / 2)) / scale,
        (1 + Math.floor(rank / 3)) / scale,
      );
    }
  } else if (fx.kind === 'charge') {
    paint.contact(from, ink, alpha * clamp(fx.width) * 0.3, 10);
  } else if (fx.kind === 'surge') {
    if (t < 0.15) paint.contact(from, ink, (1 - t / 0.15) * 0.7, 9.6);
  } else if (fx.kind === 'return') {
    paint.beam('return', from, to, clock, ink, alpha * light, 16, power);
    const travel = clamp(t / 0.7);
    const point = { x: lerp(from.x, to.x, travel), y: lerp(from.y, to.y, travel) };
    g.fillStyle(WHITE, alpha);
    g.fillRect(point.x - 1 / scale, point.y - 1 / scale, 2 / scale, 2 / scale);
    if (t >= 0.65) paint.contact(to, ink, (1 - t) / 0.35, (22 + power * 2) / 2.5);
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
    paint.beam(id, from, to, clock, ink, light * opacity, 16, power);
    if (fx.source === 'charge') paint.contact(from, ink, opacity, 9.6);
    if (fx.kind === 'focus') {
      const flow = (time * 3 + (fx.targetId ?? 0) * 0.17) % 1;
      g.fillStyle(WHITE, 0.8);
      g.fillRect(lerp(from.x, to.x, flow), lerp(from.y, to.y, flow), 2 / scale, 2 / scale);
    }
    if (fx.source === 'repel') arrow(g, { x: 180, y: 260 }, to, ink, alpha, scale);
    if (fx.kind !== 'focus' && fx.kind !== 'strike') {
      paint.sprite(fx.source === 'charge' ? 'impact' : 'hit', to, t, ink, opacity, impactSize);
    }
    if (fx.kind === 'strike') {
      paint.sprite('impact', to, t, ink, alpha, impactSize);
    }
  } else if (fx.kind === 'pierce') {
    paint.beam('pierce', from, to, clock, ink, light * alpha, 16, power);
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
    paint.sprite('dissolve', from, t, fx.radius > 8 ? WHITE : BLUE, (1 - t) ** 2);
  } else {
    ring(g, from, fx.radius * (0.25 + 0.75 * t), ink, alpha * 0.6, scale, 1);
  }
}
