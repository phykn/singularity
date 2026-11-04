import type Phaser from 'phaser';
import { orbit } from '../game/geometry.ts';
import { RED } from '../art/palette.ts';

export function drawWaveWarning(
  graphics: Phaser.GameObjects.Graphics,
  angle: number,
  elapsed: number,
  scale: number,
): void {
  const alpha = 0.3 + 0.65 * (0.5 + 0.5 * Math.cos(elapsed * Math.PI * 4));
  const pixel = 1 / scale;
  for (const offset of [0, Math.PI]) {
    graphics.lineStyle(3 * pixel, RED, alpha);
    graphics.beginPath();
    for (let i = 0; i <= 16; i++) {
      const point = orbit(angle + offset - 0.24 + (i * 0.48) / 16, 172);
      if (!i) graphics.moveTo(point.x, point.y);
      else graphics.lineTo(point.x, point.y);
    }
    graphics.strokePath();
    const marker = orbit(angle + offset, 156);
    graphics.fillStyle(RED, alpha);
    graphics.fillRect(marker.x - 2 * pixel, marker.y - 7 * pixel, 4 * pixel, 9 * pixel);
    graphics.fillRect(marker.x - 2 * pixel, marker.y + 5 * pixel, 4 * pixel, 3 * pixel);
  }
}
