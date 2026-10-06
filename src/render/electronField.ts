import type Phaser from 'phaser';
import type { Point } from '../game/geometry.ts';
import { clamp } from '../game/geometry.ts';
import type { SkillStatus } from '../game/types.ts';
import { skillColors, WHITE } from '../art/palette.ts';

export function drawElectronField(
  g: Phaser.GameObjects.Graphics,
  point: Point,
  time: number,
  scale: number,
  charge: SkillStatus,
  surging: boolean,
  chargeRank = 1,
  surgeRank = 1,
): void {
  const stored = clamp(charge.progress);
  if (!surging && stored <= 0) return;
  const rank = Math.max(1, Math.min(5, surging ? surgeRank : chargeRank));
  const pulse = surging ? Math.sin(time * 3) * 0.035 : 0;
  const radius = (10 + (rank - 1) * 0.35 + (surging ? 1 : stored)) / scale;
  const color = surging ? skillColors.surge : skillColors.charge;
  const opacity = surging ? 0.7 + pulse : 0.18 + stored * 0.24;
  // A single hollow aura: soft edge and crisp contour share the same radius.
  g.lineStyle((3 + (rank - 1) * 0.2) / scale, color, opacity * 0.16);
  g.strokeCircle(point.x, point.y, radius);
  g.lineStyle((1 + (rank - 1) * 0.12) / scale, color, opacity);
  g.strokeCircle(point.x, point.y, radius);
  if (stored > 0) {
    // Charge fills the existing contour, including while Surge is active.
    const weight = 1.4 + (Math.max(1, Math.min(5, chargeRank)) - 1) * 0.1;
    g.lineStyle(weight / scale, surging ? WHITE : skillColors.charge, 0.9);
    g.beginPath();
    g.arc(point.x, point.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * stored);
    g.strokePath();
  }
}
