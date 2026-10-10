import type Phaser from 'phaser';
import { OrbitRhythm } from '../app/OrbitRhythm.ts';
import { orbit, CENTER } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import { WHITE, BLUE } from '../art/palette.ts';

const turn = Math.PI * 2;

export function drawRhythm(
  g: Phaser.GameObjects.Graphics,
  rhythm: OrbitRhythm,
  radius: number,
  scale: number,
  electron: Point,
  reducedMotion: boolean,
): void {
  const arc = (
    r: number,
    start: number,
    end: number,
    width: number,
    color: number,
    alpha: number,
  ) => {
    g.lineStyle(width / scale, color, alpha);
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, r, start, end, false);
    g.strokePath();
  };
  if (rhythm.active) {
    const a = rhythm.gateAngle;
    const half = rhythm.windowAngle;
    const approaching = rhythm.gateAngle - rhythm.angle < Math.PI * 2;
    const bright = rhythm.open ? 1 : approaching ? 0.65 : 0.2;
    // Only the electron moves. The bracket marks the actual accepted orbit segment.
    arc(radius, a - half, a + half, 12, 0x080a0e, 0.9);
    arc(radius, a - half, a + half, 8, BLUE, rhythm.open ? 0.5 : 0.18);
    for (const r of [radius - 5 / scale, radius + 5 / scale])
      arc(r, a - half, a + half, rhythm.open ? 2 : 1, WHITE, bright);
    for (const edge of [-1, 1]) {
      const inside = orbit(a + edge * half, radius - 8 / scale);
      const outside = orbit(a + edge * half, radius + 8 / scale);
      g.lineStyle(2 / scale, WHITE, bright);
      g.lineBetween(inside.x, inside.y, outside.x, outside.y);
    }
    for (let i = 0; i < 3; i++) {
      const p = orbit(a + ((i - 1) * 10) / (radius * scale), radius + 15 / scale);
      g.fillStyle(i < rhythm.hits ? BLUE : WHITE, i < rhythm.hits ? 1 : 0.3);
      g.fillRect(p.x - 2 / scale, p.y - 2 / scale, 4 / scale, 4 / scale);
    }
    if (rhythm.hits) {
      g.lineStyle(2 / scale, BLUE, 0.55 + rhythm.hits * 0.15);
      g.strokeCircle(electron.x, electron.y, (7 + rhythm.hits * 2) / scale);
    }
  }
  const age = rhythm.feedbackAge / 1000;
  if (rhythm.feedback === 'hit' && age < 0.28) {
    const p = orbit(rhythm.hitAngle, radius);
    g.lineStyle(2 / scale, WHITE, 1 - age / 0.28);
    g.strokeCircle(p.x, p.y, (reducedMotion ? 10 : 6 + age * 45) / scale);
  }
  if (rhythm.feedback === 'complete' && age < 0.6) {
    const fade = 1 - age / 0.6;
    // Clear edges show the affected orbit band without covering the battle.
    const spread = reducedMotion ? 12 : 5 + Math.min(1, age / 0.25) * 31;
    for (const r of [radius - spread, radius + spread]) {
      for (let i = 0; i < 6; i++) {
        const a = rhythm.hitAngle + (i * turn) / 6;
        arc(r, a + 0.04 + age * 0.1, a + 0.86 - age * 0.35, 1 + 3 * fade, WHITE, fade);
      }
    }
    arc(radius, 0, turn, 2 + 3 * fade, BLUE, fade * 0.9);
  }
}
