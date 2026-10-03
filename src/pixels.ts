import type Phaser from 'phaser';

const art = {
  electron: ['.....222.....', '...2233322...', '..233444332..', '.23344444332.', '.23444443332.', '2344444433332', '2344444433332', '2334444333332', '.23333333332.', '.23333333322.', '..233333322..', '...2233322...', '.....222.....'],
  small: ['....222....', '..2233322..', '.234443332.', '.24...3332.', '234.....332', '233..4..332', '233.....332', '.23...3332.', '.233333322.', '..2233322..', '....222....'],
  dense: ['......222......', '.....23332.....', '....2344432....', '...234444332...', '..2344.333332..', '.2344...333332.', '2344.....333332', '234...4...33332', '2333.....333332', '.2333...333332.', '..2333.333332..', '...233333332...', '....2333332....', '.....23332.....', '......222......'],
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
