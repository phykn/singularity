import type Phaser from 'phaser';
import type { Point } from '../game/geometry.ts';
import { clamp } from '../game/geometry.ts';
import type { SkillStatus } from '../game/types.ts';
import { skillColors, WHITE } from '../art/palette.ts';
import type { EffectStamp } from './effects.ts';

export function drawElectronField(
  g: Phaser.GameObjects.Graphics,
  point: Point,
  time: number,
  scale: number,
  charge: SkillStatus,
  surging: boolean,
  stamp: EffectStamp,
  chargeRank = 1,
  surgeRank = 1,
): void {
  const stored = clamp(charge.progress);
  if (surging) {
    stamp(
      'surge',
      point,
      time * 0.45,
      skillColors.surge,
      0.9,
      30 + Math.max(0, Math.min(4, surgeRank - 1)),
    );
    // Charge remains readable during surge without stacking a second aura.
    if (stored > 0) {
      g.fillStyle(WHITE, 0.35 + stored * 0.6);
      g.fillRect(
        point.x + 8 / scale,
        point.y + 7 / scale,
        Math.ceil(stored * 3) / scale,
        1 / scale,
      );
    }
  } else if (stored > 0) {
    const growth = Math.max(0, Math.min(4, chargeRank - 1));
    stamp(
      'charge',
      point,
      time * 0.35,
      skillColors.charge,
      0.3 + stored * 0.6,
      26 + Math.round(stored * 4) + growth,
    );
  }
}
