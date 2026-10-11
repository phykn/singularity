import Phaser from 'phaser';

export const damageFonts = { high: 'damage-high', normal: 'damage-normal', low: 'damage-low' };

export function createDamageFont(scene: Phaser.Scene): void {
  const chars = '0123456789',
    size = 12,
    padding = 2;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  measure.font = `${size}px "Singularity Pixel", monospace`;
  const metrics = measure.measureText(chars);
  const advance = Math.ceil(measure.measureText('0').width);
  const width = advance + padding * 2;
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent);
  const height = ascent + Math.ceil(metrics.actualBoundingBoxDescent) + padding * 2;
  canvas.width = width * chars.length;
  canvas.height = height * 3;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${size}px "Singularity Pixel", monospace`;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#080a0e';
  for (const [row, color] of ['#ffda96', '#f1fcff', '#b8eefb'].entries()) {
    ctx.fillStyle = color;
    for (let i = 0; i < chars.length; i++) {
      const x = i * width + padding,
        y = row * height + padding + ascent;
      ctx.strokeText(chars[i], x, y);
      ctx.fillText(chars[i], x, y);
    }
  }
  scene.textures.addCanvas('damage-digits', canvas);
  for (const [row, key] of Object.values(damageFonts).entries()) {
    // Phaser's declaration describes font data; Parse returns its cache entry.
    const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
      image: 'damage-digits',
      width,
      height,
      chars,
      charsPerRow: 10,
      'offset.x': 0,
      'offset.y': row * height,
      'spacing.x': 0,
      'spacing.y': 0,
      lineSpacing: 0,
    }) as unknown as { data: Phaser.Types.GameObjects.BitmapText.BitmapFontData };
    entry.data.size = size;
    for (const glyph of Object.values(entry.data.chars))
      Object.assign(glyph, { xAdvance: advance });
    scene.cache.bitmapFont.add(key, entry);
  }
}
