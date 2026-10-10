import type Phaser from 'phaser';
import { AMBER, WHITE } from '../art/palette.ts';
import { orbit } from '../game/geometry.ts';
import type { endingFrame } from '../presentation/ending.ts';

export function drawCollapse(
  g: Phaser.GameObjects.Graphics,
  frame: NonNullable<ReturnType<typeof endingFrame>>,
  scale: number,
) {
  if (frame.success) return;
  if (frame.electron) {
    const gap = 0.78 * frame.fracture;
    const points = Array.from({ length: 65 }, (_, i) =>
      orbit(frame.contactAngle + gap + ((Math.PI * 2 - gap * 2) * i) / 64, frame.radius),
    );
    g.lineStyle(2 / scale, AMBER, 0.7 - frame.fracture * 0.3);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) g.lineTo(point.x, point.y);
    g.strokePath();
  }
  if (!frame.flash || !frame.contact || !frame.contactFrom) return;
  const point = frame.contact,
    from = frame.contactFrom;
  const dx = Math.cos(frame.contactAngle),
    dy = Math.sin(frame.contactAngle);
  g.lineStyle(1 / scale, AMBER, frame.flash * 0.9);
  g.beginPath();
  g.moveTo(from.x, from.y);
  g.lineTo((from.x + point.x) / 2 - (dy * 2) / scale, (from.y + point.y) / 2 + (dx * 2) / scale);
  g.lineTo(point.x, point.y);
  g.strokePath();
  g.lineStyle(1 / scale, AMBER, frame.flash * 0.7);
  g.strokeCircle(point.x, point.y, (4 + (1 - frame.flash) * 5) / scale);
  g.fillStyle(WHITE, frame.flash);
  g.fillRect(point.x - 1 / scale, point.y - 1 / scale, 2 / scale, 2 / scale);
}
