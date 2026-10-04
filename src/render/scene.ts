import Phaser from 'phaser';
import { createPixels } from './pixels.ts';
import { healthBar } from './health.ts';
import { visibleEffects } from './effects.ts';
import { numberText } from '../format.ts';
import { maxDamageNumbers } from '../game/rules.ts';
import { orbit, clamp, lerp } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import type { Game } from '../game/model.ts';

import { BLUE, WHITE, AMBER, GOLD } from './palette.ts';
import { drawEffect } from './lightning.ts';

export class ElectronScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private effectGraphics!: Phaser.GameObjects.Graphics;
  private sprites: Phaser.GameObjects.Image[] = [];
  private spriteCount = 0;
  private width = 0;
  private centerY = 0;
  private worldScale = 1;
  private damageText: Phaser.GameObjects.Text[] = [];
  private model: () => Game;
  private reduced: () => boolean;
  constructor(model: () => Game, reduced: () => boolean) {
    super('electron');
    this.model = model;
    this.reduced = reduced;
  }
  create(): void {
    this.graphics = this.add.graphics();
    this.effectGraphics = this.add.graphics().setDepth(1);
    createPixels(this);
  }

  update(): void {
    const g = this.graphics;
    if (!g) return;
    const model = this.model(),
      reduced = this.reduced();
    const width = this.scale.width,
      height = this.scale.height,
      scale = Math.min(width, height) / 360;
    for (const text of this.damageText) text.setActive(false).setVisible(false);
    for (const sprite of this.sprites) sprite.setActive(false).setVisible(false);
    this.spriteCount = 0;
    this.effectGraphics.clear();
    g.clear();
    this.width = width;
    this.worldScale = scale;
    this.centerY = height > width ? Math.max(170 * scale + 8, height * 0.42) : height / 2;
    if (model.phase === 'ready') {
      this.drawIntro(width, height, reduced);
      return;
    }
    g.setPosition(width / 2 - 180 * scale, this.centerY - 260 * scale);
    g.setScale(scale);
    this.effectGraphics.setPosition(g.x, g.y).setScale(scale);
    const ending = model.phase === 'ending' || model.phase === 'result';
    const collapsing = model.phase === 'collapse';
    const clock = model.seconds;
    const progress = model.phase === 'result' ? 1 : model.phaseProgress;
    const success = ending && model.successfulEnding;
    const absorb = success ? clamp(progress * 1.8) : 0;
    const color = model.charged ? GOLD : BLUE;
    const danger = !model.charged && model.margin < 24;
    const damage = model.damage,
      position = model.position;
    const angle = model.angle + (collapsing ? progress * progress * Math.PI * 5 : 0);
    const radius = collapsing ? model.radius * (1 - progress ** 1.5) : model.radius * (1 - absorb);

    if (!ending || (success && absorb < 1)) {
      g.lineStyle((danger ? 1.6 : 1) / scale, danger ? AMBER : color, 0.38 * (1 - absorb));
      g.strokeCircle(180, 260, radius);
    }

    if (!ending && model.mass > 0) {
      const core = model.core;
      this.drawCore(core, scale);
      if (danger) {
        g.lineStyle(2 / scale, AMBER, reduced ? 0.85 : 0.65 + 0.25 * Math.sin(clock * 6));
        g.beginPath();
        for (let i = 0; i <= 12; i++) {
          const p = orbit(angle - 0.4 + (i / 12) * 0.8, core + 4 / scale);
          if (!i) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        }
        g.strokePath();
      }
    }

    const warning = model.warningWave;
    if (warning) {
      for (const offset of [0, Math.PI]) {
        g.lineStyle(2 / scale, AMBER, reduced ? 0.65 : 0.4 + 0.3 * Math.sin(clock * 5));
        g.beginPath();
        for (let i = 0; i <= 16; i++) {
          const p = orbit(warning.angle + offset - 0.25 + (i / 16) * 0.5, 172);
          if (i === 0) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        }
        g.strokePath();
      }
    }

    for (const target of model.targets) {
      const t = absorb ** 1.5,
        x = lerp(target.x, 180, t),
        y = lerp(target.y, 260, t);
      const size =
        Math.max(target.size * 2, (target.kind === 'small' ? 6 : 9) / scale) * (1 - absorb);
      if (size <= 0 || (ending && !success)) continue;
      const hit = !reduced && target.hitAt !== undefined && model.time - target.hitAt < 0.1;
      const point = this.screen({ x, y });
      const sprite = this.sprite(point, target.particle, 1, 1 - absorb);
      if (hit) {
        sprite.setTint(WHITE);
        sprite.setTintFill();
      } else sprite.clearTint();
      const bar = !ending && healthBar(target, damage);
      if (bar) {
        const left = (Math.round(point.x) - Math.floor(bar.width / 2) - g.x) / scale;
        const top = (Math.round(point.y) - bar.offset - g.y) / scale;
        g.fillStyle(0x492129, 1);
        g.fillRect(left, top, bar.width / scale, bar.height / scale);
        g.fillStyle(0xe45d68, 1);
        g.fillRect(left, top, bar.filled / scale, bar.height / scale);
      }
    }

    if (!ending)
      for (const fx of visibleEffects(model.effects, reduced))
        drawEffect(this.effectGraphics, fx, model.seconds, scale, reduced, position, model.targets);

    if (ending) {
      if (success) {
        const r = 4 + progress ** 2 * 390;
        for (let ring = 3; ring > 0; ring--) {
          g.lineStyle((5 + ring * 4) / scale, color, 0.04 / ring);
          g.strokeCircle(180, 260, r + ring * 5);
        }
        g.fillStyle(0x030407, 1);
        g.fillCircle(180, 260, r);
        g.lineStyle(1.8 / scale, WHITE, 0.85);
        g.strokeCircle(180, 260, r);
        if (!reduced && progress < 0.8)
          for (let i = 0; i < 12; i++) {
            const a = (i * Math.PI) / 6 + clock * 0.3;
            g.lineStyle(1 / scale, color, 0.16 * (1 - absorb));
            g.lineBetween(
              180 + Math.cos(a) * (r + 5),
              260 + Math.sin(a) * (r + 5),
              180 + Math.cos(a + 0.2) * (r + 45),
              260 + Math.sin(a + 0.2) * (r + 45),
            );
          }
      } else {
        g.lineStyle(2 / scale, WHITE, 1 - progress);
        g.strokeCircle(180, 260, 4 + Math.sin(progress * Math.PI) * 15);
        g.fillStyle(WHITE, (1 - progress) ** 3);
        g.fillCircle(180, 260, 4);
        for (let i = 0; i < 8; i++) {
          const p = orbit((i * Math.PI) / 4, 5 + progress * 35);
          g.fillStyle(WHITE, 1 - progress);
          g.fillRect(p.x, p.y, 2 / scale, 2 / scale);
        }
      }
      return;
    }

    const electron = orbit(angle, radius),
      tail = reduced ? 5 : Math.min(45, 10 + model.boosts.accel * 7);
    for (let i = tail; i > 0; i--) {
      const p = orbit(angle - i * 0.035, radius),
        next = orbit(angle - (i - 1) * 0.035, radius);
      g.lineStyle((1 + 2 * (1 - i / tail)) / scale, color, 0.65 * (1 - i / tail));
      g.lineBetween(p.x, p.y, next.x, next.y);
    }
    if (collapsing && model.mass === 0) this.drawElectron(orbit(angle + Math.PI, radius), 1, color);
    this.drawElectron(electron, 1, color);
    if (!collapsing) this.drawDamage(model, width, height, scale, reduced);
  }

  private drawCore(radius: number, scale: number): void {
    const g = this.graphics,
      pixel = 2 / scale;
    const point = ([x, y]: number[]) =>
      new Phaser.Math.Vector2(
        180 + Math.round((x * radius) / pixel) * pixel,
        260 + Math.round((y * radius) / pixel) * pixel,
      );
    const hull = [
      [-0.84, -0.4],
      [-0.52, -0.79],
      [-0.1, -0.94],
      [0.36, -0.88],
      [0.69, -0.6],
      [0.94, -0.13],
      [0.78, 0.37],
      [0.4, 0.82],
      [-0.12, 0.96],
      [-0.54, 0.71],
      [-0.89, 0.23],
    ];
    const facets = [
      {
        ink: 0x344d60,
        points: [hull[0], hull[1], hull[2], hull[3], [0.18, -0.2], [-0.3, 0.06], hull[10]],
      },
      {
        ink: 0x47687a,
        points: [hull[1], hull[2], hull[3], [-0.08, -0.49], [-0.3, -0.12], hull[0]],
      },
      {
        ink: 0x182a37,
        points: [[0.18, -0.2], hull[3], hull[4], hull[5], [0.46, 0.2], [0.07, 0.31]],
      },
      {
        ink: 0x385464,
        points: [hull[5], hull[6], hull[7], [0.11, 0.62], [0.07, 0.31], [0.46, 0.2]],
      },
      { ink: 0x142431, points: [hull[7], hull[8], hull[9], hull[10], [-0.35, 0.24], [0.11, 0.62]] },
      {
        ink: 0x526f80,
        points: [
          [-0.35, 0.24],
          [-0.3, 0.06],
          [0.18, -0.2],
          [0.07, 0.31],
          [-0.12, 0.47],
        ],
      },
    ];
    g.fillStyle(0x263e4c, 1);
    g.fillPoints(hull.map(point), true);
    for (const facet of facets) {
      g.fillStyle(facet.ink, 1);
      g.fillPoints(facet.points.map(point), true);
    }
    g.lineStyle(pixel, 0x91b6c6, 0.75);
    g.strokePoints([hull[0], hull[1], hull[2]].map(point), false);
    g.lineStyle(pixel, 0x62889b, 0.6);
    g.strokePoints([hull[5], hull[6], hull[7]].map(point), false);
  }

  private drawDamage(
    model: Game,
    width: number,
    height: number,
    scale: number,
    reduced: boolean,
  ): void {
    const numbers = model.damageNumbers.slice(-maxDamageNumbers).reverse();
    const occupied: Phaser.Geom.Rectangle[] = [],
      limit = reduced ? 12 : 24;
    for (const damage of numbers) {
      const age = model.seconds - damage.born;
      if ((reduced && age > 0.4) || occupied.length >= limit) continue;
      const index = occupied.length;
      const text = (this.damageText[index] ??= this.add
        .text(0, 0, '', {
          fontFamily: 'Singularity Pixel, monospace',
          fontSize: '12px',
          color: '#ecfbff',
          stroke: '#080a0e',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(3)
        .setResolution(1));
      const x = width / 2 + (damage.x - 180) * scale;
      const y = this.centerY + (damage.y - 260) * scale - 4 - (reduced ? 0 : age * 16);
      text.setText(numberText(damage.value)).setScale(1);
      let placed = false;
      for (const [dx, dy] of [
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
        placed = true;
        break;
      }
      text.setActive(placed).setVisible(placed);
      if (!placed) continue;
      const color = damage.value >= 5 ? '#ffda96' : damage.value > 2 ? '#f1fcff' : '#b8eefb';
      if (text.style.color !== color) text.setColor(color);
      text.setAlpha(reduced ? 1 : 1 - clamp((age - 0.35) / 0.37));
    }
  }

  private drawIntro(width: number, height: number, reduced: boolean): void {
    const g = this.graphics,
      clock = reduced ? 0 : this.time.now / 1000;
    const x = width / 2,
      y = height * 0.51;
    const radius = Math.min(width * 0.44, height * 0.45, 184),
      core = radius * 0.42;
    g.setPosition(0, 0);
    g.setScale(1);

    g.lineStyle(1, 0x7295af, 0.4);
    g.strokeCircle(x, y, radius);
    g.fillStyle(0x04060a, 1);
    g.fillCircle(x, y, core);
    g.lineStyle(0.8, 0xa7c4d9, 0.3);
    g.strokeCircle(x, y, core);
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2,
        next = ((i + 1) / 96) * Math.PI * 2;
      const light = (0.5 + 0.5 * Math.cos(a + 2.2 + clock * 0.07)) ** 5;
      for (const [stroke, alpha, ink] of [
        [5, 0.13, BLUE],
        [3, 0.35, BLUE],
        [1, 1, WHITE],
      ]) {
        g.lineStyle(stroke, ink, alpha * light);
        g.lineBetween(
          x + Math.cos(a) * core,
          y + Math.sin(a) * core,
          x + Math.cos(next) * core,
          y + Math.sin(next) * core,
        );
      }
    }

    const angle = -0.65 + clock * 0.24;
    for (let i = 36; i > 0; i--) {
      const a = angle - i * 0.022,
        next = angle - (i - 1) * 0.022;
      g.lineStyle(1.5, BLUE, (1 - i / 36) * 0.7);
      g.lineBetween(
        x + Math.cos(a) * radius,
        y + Math.sin(a) * radius,
        x + Math.cos(next) * radius,
        y + Math.sin(next) * radius,
      );
    }
    const electron = { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
    this.sprite(electron, 'electron', 1, 1, 2).clearTint();
  }

  private screen(point: Point): Point {
    return {
      x: this.width / 2 + (point.x - 180) * this.worldScale,
      y: this.centerY + (point.y - 260) * this.worldScale,
    };
  }

  private sprite(
    point: Point,
    key: string,
    scale: number,
    alpha = 1,
    depth = 0.5,
  ): Phaser.GameObjects.Image {
    const index = this.spriteCount++;
    const sprite = (this.sprites[index] ??= this.add.image(point.x, point.y, key));
    if (sprite.texture.key !== key) sprite.setTexture(key);
    const x = Math.round(point.x),
      y = Math.round(point.y);
    if (sprite.x !== x || sprite.y !== y) sprite.setPosition(x, y);
    if (sprite.scaleX !== scale || sprite.scaleY !== scale) sprite.setScale(scale);
    if (sprite.alpha !== alpha) sprite.setAlpha(alpha);
    if (sprite.depth !== depth) sprite.setDepth(depth);
    return sprite.setActive(true).setVisible(true);
  }

  private drawElectron(point: Point, alpha: number, color = BLUE): void {
    const sprite = this.sprite(this.screen(point), 'electron', 1, alpha, 2);
    if (color === GOLD) sprite.setTint(GOLD);
    else sprite.clearTint();
  }
}
