import type Phaser from 'phaser';

const art = {
  electron: ['...111...', '..12221..', '.1233321.', '123444321', '123444321', '123444321', '.1233321.', '..12221..', '...111...'],
  small: ['.........', '...111...', '..12221..', '.12...21.', '.12.3.21.', '.12...21.', '..12221..', '...111...', '.........'],
  dense: ['....111....', '...12221...', '..1233321..', '.123...321.', '123.....321', '123..4..321', '123.....321', '.123...321.', '..1233321..', '...12221...', '....111....'],
  satellite: ['..1..', '.232.', '13431', '.232.', '..1..'],
};

export function createPixels(scene: Phaser.Scene): void {
  for (const [key, rows] of Object.entries(art)) {
    const texture = scene.textures.createCanvas(key, rows[0].length, rows.length)!;
    const ctx = texture.getContext();
    const palette = key === 'dense'
      ? ['', '#ffc66f20', '#9c5a38', '#ffc66f', '#fff3c5']
      : ['', '#64cce020', '#337f9b', '#8ce8fb', '#f1fcff'];
    rows.forEach((row, y) => [...row].forEach((char, x) => {
      if (char !== '.') { ctx.fillStyle = palette[Number(char)]; ctx.fillRect(x, y, 1, 1); }
    }));
    texture.refresh();
  }
}
