import type Phaser from 'phaser';
import { particleArt, particlePalettes } from '../art/particles.ts';

export function createParticleTextures(scene: Phaser.Scene): void {
  for (const [key, rows] of Object.entries(particleArt)) {
    const texture = scene.textures.createCanvas(key, rows[0].length, rows.length)!;
    const ctx = texture.getContext();
    const palette = particlePalettes[key as keyof typeof particleArt];
    rows.forEach((row, y) =>
      [...row].forEach((char, x) => {
        if (char !== '.') {
          ctx.fillStyle = palette[Number(char)];
          ctx.fillRect(x, y, 1, 1);
        }
      }),
    );
    texture.refresh();
  }
}
