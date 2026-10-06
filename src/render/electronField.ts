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
  if (stored > 0) {
    const growth = Math.max(0, Math.min(4, chargeRank - 1));
    const size = (surging ? 26 : 26 + Math.round(stored * 6)) + growth;
    stamp(
      'charge',
      point,
      time * (0.7 + stored * 0.6),
      skillColors.charge,
      0.25 + stored * 0.65,
      size,
    );
    const count = 1 + Math.floor(stored * 4);
    for (let i = 0; i < count; i++) {
      const phase = (time * (0.9 + stored * 0.5) + i * 0.37) % 1;
      const angle = (i * Math.PI * 2) / count + [0, 0.12, -0.08, 0.06, -0.1][i] + time * 0.3;
      const radius = (18 - phase * 10) / scale;
      g.fillStyle(
        phase > 0.7 ? WHITE : skillColors.charge,
        (0.3 + stored * 0.5) * Math.sin(phase * Math.PI),
      );
      g.fillRect(
        Math.round((point.x + Math.cos(angle) * radius) * scale) / scale,
        Math.round((point.y + Math.sin(angle) * radius) * scale) / scale,
        1 / scale,
        1 / scale,
      );
    }
  }
  if (surging)
    stamp(
      'surge',
      point,
      time * 1.2,
      skillColors.surge,
      0.95,
      32 + Math.max(0, Math.min(4, surgeRank - 1)) * 2,
    );
}
