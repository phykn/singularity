import type Phaser from 'phaser';
import { particleFrames } from './particleAtlas.ts';

export function createPixels(scene: Phaser.Scene): void {
  const image = scene.textures.get('particleAtlas').getSourceImage() as HTMLImageElement;
  for (const [key, frame] of Object.entries(particleFrames)) {
    const texture = scene.textures.createCanvas(key, frame.size, frame.size)!;
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      (frame.index % 3) * 32,
      Math.floor(frame.index / 3) * 32,
      32,
      32,
      0,
      0,
      frame.size,
      frame.size,
    );
    texture.refresh();
  }
}
