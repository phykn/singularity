import type Phaser from 'phaser';
import { clamp } from '../game/geometry.ts';
import { WHITE } from '../art/palette.ts';

// One tilted disk, occluded by its dark center. All detail lands on screen pixels.
export function drawSingularity(
  g: Phaser.GameObjects.Graphics,
  radius: number,
  scale: number,
  glow = 0,
  light = 1,
) {
  const r = Math.round(radius * scale) / scale;
  if (r <= 0) return;
  const pixel = 1 / scale;
  const point = (angle: number, disk: boolean) => {
    const x = Math.cos(angle) * r * (disk ? 1.6 : 1);
    const y = Math.sin(angle) * r * (disk ? 0.38 : 1);
    return {
      x: 180 + Math.round((x * 0.94 + y * 0.342) * scale) / scale,
      y: 260 + Math.round((-x * 0.342 + y * 0.94) * scale) / scale,
    };
  };
  const band = (front: boolean) => {
    for (let i = 0; i < 48; i++) {
      const a = ((i + (front ? 0 : 48)) * Math.PI) / 48;
      const p = point(a, true),
        q = point(a + Math.PI / 48, true);
      const bright = (1 + Math.cos(a - 0.5)) / 2;
      const sweep = glow > 0 ? Math.max(0, 1 - Math.abs(i / 48 - (1 - glow)) * 7) : 0;
      g.lineStyle(
        (front ? 2 + bright : 1) * pixel,
        0xd7ad68,
        light * (front ? 0.35 + bright * 0.35 : 0.3),
      );
      g.lineBetween(p.x, p.y, q.x, q.y);
      if (front) {
        g.lineStyle(pixel, WHITE, light * (0.35 + bright * 0.5 + sweep * 0.15));
        g.lineBetween(p.x, p.y, q.x, q.y);
      }
    }
  };
  band(false);
  g.fillStyle(0x020306, 1);
  g.fillCircle(180, 260, r);
  // A broken lensing crescent leaves the center readable without another outline.
  for (let i = 0; i < 40; i++) {
    const a = Math.PI * (1.02 + i * 0.024);
    const p = point(a, false),
      q = point(a + Math.PI * 0.024, false);
    const alpha = Math.sin((i / 40) * Math.PI);
    g.lineStyle(
      (1 + Math.round(alpha)) * pixel,
      i < 25 ? WHITE : 0xd7ad68,
      light * alpha * (0.65 + glow * 0.3),
    );
    g.lineBetween(p.x, p.y, q.x, q.y);
  }
  band(true);
  if (glow > 0 && light > 0) {
    g.fillStyle(WHITE, glow * 0.35 * light);
    const p = point(0.4, true);
    g.fillRect(p.x - pixel, p.y - pixel, 2 * pixel, 2 * pixel);
  }
}

export function drawAccretion(g: Phaser.GameObjects.Graphics, time: number, scale: number) {
  for (let i = 0; i < 6; i++) {
    const p = clamp((time - 0.25 - i * 0.1) / 0.65);
    if (p <= 0 || p >= 1) continue;
    const angle = i * 2.4 + p * 1.6;
    const radius = 24 + 20 * (1 - p) ** 2;
    g.fillStyle(i % 2 ? WHITE : 0xd7ad68, Math.sin(p * Math.PI) * 0.6);
    g.fillRect(
      180 + Math.round(Math.cos(angle) * radius * scale) / scale,
      260 + Math.round(Math.sin(angle) * radius * scale) / scale,
      1 / scale,
      1 / scale,
    );
  }
}
