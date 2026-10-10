import type Phaser from 'phaser';
import { OrbitRhythm, rhythmTiming } from '../app/OrbitRhythm.ts';
import { orbit, CENTER } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import { WHITE, BLUE } from '../art/palette.ts';

const turn = Math.PI * 2;
const duration = rhythmTiming.lead + rhythmTiming.interval * rhythmTiming.beats;
export const rhythmAngle = (ms: number) => -Math.PI / 2 + (ms / duration) * turn;

export function drawRhythm(
  g: Phaser.GameObjects.Graphics,
  rhythm: OrbitRhythm,
  radius: number,
  scale: number,
  electron: Point,
  reducedMotion: boolean,
): void {
  const r = radius + 7 / scale;
  if (rhythm.active) {
    const arc = (angle: number, width: number, color: number, alpha: number) => {
      g.lineStyle(width / scale, 0x080a0e, 0.95);
      g.beginPath();
      g.arc(CENTER.x, CENTER.y, r, angle - 0.1, angle + 0.1, false);
      g.strokePath();
      g.lineStyle((width - 2) / scale, color, alpha);
      g.beginPath();
      g.arc(CENTER.x, CENTER.y, r, angle - 0.09, angle + 0.09, false);
      g.strokePath();
    };
    for (let i = 0; i < rhythmTiming.beats; i++) {
      const due = rhythmTiming.lead + i * rhythmTiming.interval;
      const angle = rhythmAngle(due);
      const done = i < rhythm.hits;
      const open = i === rhythm.hits && rhythm.open;
      const p = orbit(angle, r);
      arc(angle, open ? 9 : 7, done ? BLUE : WHITE, done || open ? 1 : 0.38);
      // A filled diamond records a hit; the next gate is an open bracket.
      if (done) {
        g.fillStyle(BLUE, 1);
        g.fillTriangle(p.x, p.y - 4 / scale, p.x - 4 / scale, p.y, p.x + 4 / scale, p.y);
        g.fillTriangle(p.x, p.y + 4 / scale, p.x - 4 / scale, p.y, p.x + 4 / scale, p.y);
      } else {
        for (const edge of [-1, 1]) {
          const a = angle + edge * 0.12;
          const inside = orbit(a, r - 6 / scale),
            outside = orbit(a, r + 6 / scale);
          g.lineStyle(2 / scale, WHITE, open ? 1 : 0.5);
          g.lineBetween(inside.x, inside.y, outside.x, outside.y);
        }
      }
    }
    const angle = rhythmAngle(rhythm.age);
    arc(angle, 7, WHITE, 1);
    const p = orbit(angle, r);
    const inner = orbit(angle, r - 9 / scale);
    g.lineStyle(2 / scale, WHITE, 1);
    g.lineBetween(inner.x, inner.y, p.x, p.y);
  }
  const age = rhythm.feedbackAge / 1000;
  if (rhythm.feedback === 'complete' && age < 0.45) {
    const fade = 1 - age / 0.45;
    g.lineStyle((1 + 2 * fade) / scale, WHITE, fade * 0.85);
    g.strokeCircle(electron.x, electron.y, (reducedMotion ? 12 : 8 + age * 90) / scale);
    if (!reducedMotion) {
      for (let i = 0; i < 6; i++) {
        const a = (i * turn) / 6 + 0.2;
        const inner = (12 + age * 32) / scale,
          outer = inner + (8 * fade) / scale;
        g.lineBetween(
          electron.x + Math.cos(a) * inner,
          electron.y + Math.sin(a) * inner,
          electron.x + Math.cos(a) * outer,
          electron.y + Math.sin(a) * outer,
        );
      }
    }
  }
}
