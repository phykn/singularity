import type Phaser from 'phaser';
import type { Point } from '../game/geometry.ts';

export class SpritePool {
  readonly images: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private visible = 0;
  private add: Phaser.GameObjects.GameObjectFactory;

  constructor(add: Phaser.GameObjects.GameObjectFactory) {
    this.add = add;
  }

  begin(): void {
    this.used = 0;
  }

  end(): void {
    for (let idx = this.used; idx < this.visible; idx++)
      this.images[idx].setActive(false).setVisible(false);
    this.visible = this.used;
  }

  draw(
    point: Point,
    key: string,
    scale = 1,
    alpha = 1,
    depth = 0.5,
    frame?: number,
    rotation = 0,
    scaleY = scale,
  ): Phaser.GameObjects.Image {
    const idx = this.used++;
    const image = (this.images[idx] ??= this.add.image(point.x, point.y, key));
    if (image.texture.key !== key || (frame !== undefined && Number(image.frame.name) !== frame))
      image.setTexture(key, frame);
    const x = Math.round(point.x),
      y = Math.round(point.y);
    if (image.x !== x || image.y !== y) image.setPosition(x, y);
    if (image.scaleX !== scale || image.scaleY !== scaleY) image.setScale(scale, scaleY);
    if (image.alpha !== alpha) image.setAlpha(alpha);
    if (image.depth !== depth) image.setDepth(depth);
    if (image.rotation !== rotation) image.setRotation(rotation);
    if (!image.active) image.setActive(true);
    if (!image.visible) image.setVisible(true);
    return image;
  }
}
