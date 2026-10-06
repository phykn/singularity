import Phaser from 'phaser';
import type { Game } from '../game/Game.ts';
import { maxDamageNumbers } from '../game/rules.ts';
import { clamp } from '../game/geometry.ts';

export class DamageLabels {
  readonly texts: Phaser.GameObjects.Text[] = [];
  private labels = new Map<number, Phaser.GameObjects.Text>();
  private offsets = new Map<number, readonly number[]>();
  private lastGame: Game | null = null;
  private viewport = '';
  private free: Phaser.GameObjects.Text[] = [];
  private add: Phaser.GameObjects.GameObjectFactory;

  constructor(add: Phaser.GameObjects.GameObjectFactory) {
    this.add = add;
  }

  hide(): void {
    for (const text of this.texts) if (text.visible) text.setActive(false).setVisible(false);
  }
  draw(game: Game, width: number, height: number, centerY: number, scale: number): void {
    const viewport = `${width}:${height}:${centerY}:${scale}`;
    if (this.lastGame !== game || this.viewport !== viewport) this.offsets.clear();
    this.lastGame = game;
    this.viewport = viewport;
    // Existing hits keep their lanes; fresh hits take the remaining space.
    const numbers = game.damageNumbers
      .slice(-maxDamageNumbers)
      .reverse()
      .sort((a, b) => Number(this.offsets.has(b.id)) - Number(this.offsets.has(a.id)));
    const ids = new Set(numbers.map((damage) => damage.id));
    for (const [id, text] of this.labels) {
      if (ids.has(id)) continue;
      this.labels.delete(id);
      this.offsets.delete(id);
      this.free.push(text);
    }
    const shown = new Set<Phaser.GameObjects.Text>();
    const occupied: Phaser.Geom.Rectangle[] = [],
      limit = 24;
    for (const damage of numbers) {
      const age = game.seconds - damage.born;
      if (occupied.length >= limit) continue;
      let text = this.labels.get(damage.id);
      if (!text) {
        text = this.free.pop();
        if (!text) {
          text = this.add
            .text(0, 0, '', {
              fontFamily: 'Singularity Pixel, monospace',
              fontSize: '12px',
              color: '#ecfbff',
              stroke: '#080a0e',
              strokeThickness: 2,
            })
            .setOrigin(0.5, 1)
            .setDepth(3)
            .setResolution(1);
          this.texts.push(text);
        }
        this.labels.set(damage.id, text);
      }
      const x = width / 2 + (damage.x - 180) * scale;
      const y = centerY + (damage.y - 260) * scale - 4 - age * 16;
      text.setText(String(Math.round(damage.value))).setScale(1);
      let placed = false;
      const saved = this.offsets.get(damage.id);
      for (const [dx, dy] of saved
        ? [saved]
        : [
            [0, 0],
            [0, -10],
            [-12, -6],
            [12, -6],
            [-16, -16],
            [16, -16],
          ]) {
        text.setPosition(
          Math.round(Math.max(10, Math.min(width - 10, x + dx))),
          Math.round(Math.max(12, Math.min(height - 2, y + dy))),
        );
        const bounds = text.getBounds();
        Phaser.Geom.Rectangle.Inflate(bounds, 1, 1);
        if (
          occupied.some((previous) => Phaser.Geom.Intersects.RectangleToRectangle(bounds, previous))
        )
          continue;
        occupied.push(bounds);
        this.offsets.set(damage.id, [dx, dy]);
        placed = true;
        break;
      }
      if (!placed) continue;
      shown.add(text);
      if (!text.active) text.setActive(true);
      if (!text.visible) text.setVisible(true);
      const color = damage.value >= 5 ? '#ffda96' : damage.value > 2 ? '#f1fcff' : '#b8eefb';
      if (text.style.color !== color) text.setColor(color);
      text.setAlpha(1 - clamp((age - 0.35) / 0.37));
    }
    for (const text of this.texts)
      if (text.visible && !shown.has(text)) text.setActive(false).setVisible(false);
  }
}
