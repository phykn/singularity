import Phaser from 'phaser';
import { particleArt, particlePalettes } from '../art/particles.ts';
import { CENTER, clamp } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import type { DamageNumber } from '../game/types.ts';

// Images reused frame to frame; whatever a frame does not draw is hidden.
export class SpritePool {
  private readonly images: Phaser.GameObjects.Image[] = [];
  private readonly add: Phaser.GameObjects.GameObjectFactory;
  private used = 0;
  private visible = 0;

  constructor(add: Phaser.GameObjects.GameObjectFactory) {
    this.add = add;
  }
  begin(): void {
    this.used = 0;
  }
  end(): void {
    for (let i = this.used; i < this.visible; i++)
      this.images[i].setActive(false).setVisible(false);
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
  ) {
    const image = (this.images[this.used++] ??= this.add.image(point.x, point.y, key));
    if (image.texture.key !== key || (frame !== undefined && Number(image.frame.name) !== frame))
      image.setTexture(key, frame);
    return image
      .setPosition(Math.round(point.x), Math.round(point.y))
      .setScale(scale, scaleY)
      .setAlpha(alpha)
      .setDepth(depth)
      .setRotation(rotation)
      .setActive(true)
      .setVisible(true);
  }
}

export function createParticleTextures(scene: Phaser.Scene): void {
  for (const [key, rows] of Object.entries(particleArt)) {
    const texture = scene.textures.createCanvas(key, rows[0].length, rows.length)!,
      ctx = texture.getContext(),
      palette = particlePalettes[key as keyof typeof particleArt];
    rows.forEach((row, y) =>
      [...row].forEach((char, x) => {
        if (char === '.') return;
        ctx.fillStyle = palette[Number(char)];
        ctx.fillRect(x, y, 1, 1);
      }),
    );
    texture.refresh();
  }
}

const fonts = ['damage-high', 'damage-normal', 'damage-low'];
const damageSeconds = 0.72;

// Integer damage labels from one shared digit atlas, in three brightnesses.
export class DamageLabels {
  private readonly texts: Phaser.GameObjects.BitmapText[] = [];
  private readonly add: Phaser.GameObjects.GameObjectFactory;

  constructor(scene: Phaser.Scene) {
    this.add = scene.add;
    const chars = '0123456789',
      size = 12,
      pad = 2,
      canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d')!;
    ctx.font = `${size}px "Singularity Pixel", monospace`;
    const metrics = ctx.measureText(chars),
      advance = Math.ceil(ctx.measureText('0').width),
      ascent = Math.ceil(metrics.actualBoundingBoxAscent),
      width = advance + pad * 2,
      height = ascent + Math.ceil(metrics.actualBoundingBoxDescent) + pad * 2;
    canvas.width = width * chars.length;
    canvas.height = height * fonts.length;
    ctx.font = `${size}px "Singularity Pixel", monospace`;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#080a0e';
    ['#ffda96', '#f1fcff', '#b8eefb'].forEach((color, row) => {
      ctx.fillStyle = color;
      for (let i = 0; i < chars.length; i++) {
        ctx.strokeText(chars[i], i * width + pad, row * height + pad + ascent);
        ctx.fillText(chars[i], i * width + pad, row * height + pad + ascent);
      }
    });
    scene.textures.addCanvas('damage-digits', canvas);
    fonts.forEach((key, row) => {
      // Phaser declares font data; Parse returns its cache entry.
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
    });
  }

  draw(
    numbers: readonly DamageNumber[],
    now: number,
    width: number,
    height: number,
    centerY: number,
    scale: number,
  ): void {
    const shown = numbers.slice(-24);
    shown.forEach((damage, i) => {
      const age = now - damage.born,
        font = damage.crit || damage.value >= 5 ? fonts[0] : damage.value > 2 ? fonts[1] : fonts[2];
      const text = (this.texts[i] ??= this.add
        .bitmapText(0, 0, font, '', 12)
        .setOrigin(0.5, 1)
        .setDepth(3));
      if (text.font !== font) text.setFont(font);
      text
        .setText(String(Math.round(damage.value)))
        .setScale(damage.crit ? 1.5 : 1)
        .setPosition(
          Math.round(clamp(width / 2 + (damage.x - CENTER.x) * scale, 10, width - 10)),
          Math.round(clamp(centerY + (damage.y - CENTER.y) * scale - 4 - age * 16, 12, height - 2)),
        )
        .setAlpha(1 - clamp((age - 0.35) / (damageSeconds - 0.35)))
        .setActive(true)
        .setVisible(true);
    });
    for (const text of this.texts.slice(shown.length))
      if (text.visible) text.setActive(false).setVisible(false);
  }
}
