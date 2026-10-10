import type Phaser from 'phaser';
import type { Game } from '../game/Game.ts';
import type { Point } from '../game/geometry.ts';
import { SpritePool } from './SpritePool.ts';
import { beamFrame, beamPose, effectFrame, visibleEffects } from './effects.ts';
import type { EffectPainter } from './effects.ts';
import { drawEffect } from './drawEffects.ts';
import { drawElectronField } from './electronField.ts';

export class EffectRenderer {
  readonly graphics: Phaser.GameObjects.Graphics;
  readonly sprites: SpritePool;
  private contacts = new Map<
    string,
    { point: Point; color: number; alpha: number; radius: number }
  >();
  private screen: (point: Point) => Point;

  constructor(add: Phaser.GameObjects.GameObjectFactory, screen: (point: Point) => Point) {
    this.graphics = add.graphics().setDepth(1);
    this.sprites = new SpritePool(add);
    this.screen = screen;
  }

  begin(): void {
    this.contacts.clear();
    this.graphics.clear();
    this.sprites.begin();
  }

  setViewport(x: number, y: number, scale: number): void {
    this.graphics.setPosition(x, y).setScale(scale).setDepth(1);
  }

  draw(game: Game, scale: number, satellites: readonly Point[]): boolean {
    const g = this.graphics;
    const position = game.position;
    for (const fx of visibleEffects(game.effects))
      drawEffect(
        g,
        fx,
        game.seconds,
        scale,
        position,
        game.targets,
        this.paint,
        game.radius,
        satellites,
      );
    for (const { point, color, alpha, radius } of this.contacts.values()) {
      g.lineStyle(1 / scale, color, alpha * 0.65);
      g.strokeCircle(point.x, point.y, radius / scale);
    }
    const surging = game.combat.status('surge').active;
    if (game.ranks.charge || surging)
      drawElectronField(
        g,
        position,
        game.seconds,
        scale,
        game.combat.status('charge'),
        surging,
        game.ranks.charge,
        game.ranks.surge,
      );
    return surging;
  }

  cover(width: number, height: number, alpha: number): void {
    if (alpha <= 0) return;
    this.graphics.setPosition(0, 0).setScale(1).setDepth(3);
    this.graphics.fillStyle(0x020306, alpha);
    this.graphics.fillRect(0, 0, width, height);
  }

  end(): void {
    this.sprites.end();
  }

  private paint: EffectPainter = {
    sprite: (id, point, progress, color, alpha, size = 32) => {
      this.sprites
        .draw(this.screen(point), 'effects', size / 32, alpha, 1.5, effectFrame(id, progress))
        .clearTint()
        .setTint(color);
    },
    beam: (id, from, to, progress, color, alpha, height, strength) => {
      const pose = beamPose(this.screen(from), this.screen(to));
      if (pose.length < 1) return;
      const beam = this.sprites.draw(
        pose,
        'beams',
        pose.length / 64,
        alpha,
        1,
        beamFrame(id, progress, strength),
        pose.angle,
        height / 16,
      );
      beam.clearTint();
      if (id !== 'strike') beam.setTint(color);
    },
    contact: (point, color, alpha, radius) => {
      const screen = this.screen(point);
      const key = `${Math.round(screen.x)},${Math.round(screen.y)}`;
      const contact = this.contacts.get(key);
      if (!contact || alpha > contact.alpha)
        this.contacts.set(key, { point, color, alpha, radius });
    },
  };
}
