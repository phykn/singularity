import Phaser from 'phaser';
import { createPixels } from './pixels.ts';
import { healthBar } from './health.ts';
import { endingFrame } from './ending.ts';
import { visibleEffects } from './effects.ts';
import { numberText } from '../format.ts';
import { maxDamageNumbers } from '../game/rules.ts';
import { orbit, clamp } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import type { Game } from '../game/model.ts';

import { BLUE, WHITE, AMBER, GOLD } from './palette.ts';
import { drawEffect } from './lightning.ts';

export class ElectronScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private effectGraphics!: Phaser.GameObjects.Graphics;
  private sprites: Phaser.GameObjects.Image[] = [];
  private spriteCount = 0;
  private impactAt = -Infinity;
  private lastModel: Game | null = null;
  private returnAt = -Infinity;
  private offset = { x: 0, y: 0 };
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
    if (this.lastModel !== model) {
      this.returnAt =
        model.phase === 'ready' && this.lastModel?.result?.outcome === 'success'
          ? this.time.now
          : -Infinity;
      this.lastModel = model;
      this.impactAt = -Infinity;
    }
    if (model.phase === 'ready') {
      this.offset = { x: 0, y: 0 };
      this.drawIntro(width, height, reduced);
      this.cover(width, height, reduced ? 0 : 1 - clamp((this.time.now - this.returnAt) / 550));
      return;
    }
    g.setPosition(width / 2 - 180 * scale, this.centerY - 260 * scale);
    g.setScale(scale);
    this.effectGraphics.setPosition(g.x, g.y).setScale(scale).setDepth(1);
    const ending = endingFrame(model),
      clock = model.seconds;
    const danger = !model.charged && model.margin < 24;
    const color = model.charged ? GOLD : BLUE;
    const position = model.position,
      damage = model.damage;
    if (!reduced && !ending && clock - this.impactAt > 0.65) {
      for (let i = model.effects.length - 1; i >= 0; i--) {
        const fx = model.effects[i];
        if (clock - fx.born >= 0.05) break;
        if (
          fx.kind === 'strike' ||
          fx.kind === 'wave' ||
          fx.source === 'burst' ||
          (fx.kind === 'whip' && fx.rank >= 4)
        ) {
          this.impactAt = clock;
          break;
        }
      }
    }
    const impactAge = clock - this.impactAt;
    this.offset =
      !reduced && !ending && impactAge < 0.06
        ? { x: impactAge < 0.03 ? 1 : -1, y: 1 }
        : { x: 0, y: 0 };
    g.setPosition(g.x + this.offset.x, g.y + this.offset.y);
    this.effectGraphics.setPosition(g.x, g.y);

    const radius = ending?.electron ? ending.radius : model.radius;
    if (!ending || ending.electron || !ending.success) {
      const unstable = danger || (ending && !ending.success);
      const opacity = ending && !ending.electron ? 0.12 : 0.32;
      this.drawOrbit(
        radius,
        unstable ? AMBER : color,
        opacity,
        unstable ? (24 - Math.max(0, model.margin)) / 24 : 0,
        clock,
        scale,
        reduced,
      );
    }
    if (model.mass > 0 && (!ending || !ending.success || ending.electron))
      this.drawCore(model.core * (ending?.success ? 1 - ending.absorb * 0.7 : 1), scale);

    const warning = model.warningWave;
    if (warning) {
      g.lineStyle(1 / scale, AMBER, 0.65);
      for (const offset of [0, Math.PI]) {
        g.beginPath();
        for (let i = 0; i <= 12; i++) {
          const p = orbit(warning.angle + offset - 0.2 + i / 30, 172);
          if (!i) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        }
        g.strokePath();
      }
    }
    for (const target of model.targets) {
      if (ending && !ending.success && !ending.electron) continue;
      const absorb = ending?.absorb ?? 0;
      if (absorb >= 0.99) continue;
      const p = ending?.success
        ? orbit(target.angle + absorb * absorb * Math.PI * 2, target.radius * (1 - absorb) ** 1.5)
        : target;
      const point = this.screen(p);
      if (point.x < -20 || point.x > width + 20 || point.y < -20 || point.y > height + 20) continue;
      const hit =
        !ending &&
        target.hitAt !== undefined &&
        model.time - target.hitAt < (reduced ? 0.035 : 0.06);
      const sprite = this.sprite(point, target.particle, 1, 1 - absorb);
      if (hit) sprite.setTint(WHITE).setTintFill();
      else sprite.clearTint();
      const bar = !ending && healthBar(target, damage);
      if (bar) {
        const left = (Math.round(point.x) - Math.floor(bar.width / 2) - g.x) / scale;
        const top = (Math.round(point.y) - bar.offset - g.y) / scale;
        if (bar.filled < bar.width) {
          g.fillStyle(0x492129, 1);
          g.fillRect(left, top, bar.width / scale, bar.height / scale);
        }
        g.fillStyle(0xe45d68, 1);
        g.fillRect(left, top, bar.filled / scale, bar.height / scale);
      }
    }
    if (!ending) {
      for (const fx of visibleEffects(model.effects, reduced))
        drawEffect(this.effectGraphics, fx, model.seconds, scale, reduced, position, model.targets);
      this.drawTrail(
        model.angle,
        model.radius,
        reduced ? 5 : Math.min(45, 10 + model.boosts.accel * 7),
        color,
        scale,
      );
      this.drawElectron(position, 1, color);
      this.drawDamage(model, width, height, scale, reduced);
      return;
    }
    if (ending.electron) {
      this.drawTrail(
        ending.angle,
        ending.radius,
        reduced ? 6 : 34,
        ending.success ? GOLD : AMBER,
        scale,
        true,
      );
      this.drawElectron(ending.electron, 1, ending.success ? GOLD : AMBER);
    }
    if (ending.stage === 'silence') {
      g.fillStyle(GOLD, 0.7);
      g.fillRect(180 - 1 / scale, 260 - 1 / scale, 2 / scale, 2 / scale);
    }
    if (ending.hole) {
      const cover =
        Math.hypot(width / 2, Math.max(this.centerY, height - this.centerY)) / scale + 4;
      const radius = ending.hole + (cover - ending.hole) * ending.expansion;
      this.drawSingularity(radius, scale);
    }
    if (ending.reveal > 0) {
      g.clear();
      this.drawIntro(width, height, reduced);
      this.cover(width, height, 1 - ending.reveal);
      return;
    }
    if (ending.stage === 'impact') {
      const t = clamp((model.phaseProgress * model.rules.failureEndingSeconds) / 0.2);
      g.lineStyle(1 / scale, AMBER, 0.8 * (1 - t));
      g.strokeCircle(180, 260, (4 + 10 * t) / scale);
      g.fillStyle(WHITE, (reduced ? 0.3 : 1) * (1 - t));
      g.fillRect(180 - 5 / scale, 260, 10 / scale, 1 / scale);
      g.fillRect(180, 260 - 5 / scale, 1 / scale, 10 / scale);
    }
    if (ending.flash && !reduced) {
      g.fillStyle(WHITE, ending.flash * 0.8);
      g.fillRect(180 - 9 / scale, 260 - 2 / scale, 18 / scale, 4 / scale);
      g.fillRect(180 - 2 / scale, 260 - 9 / scale, 4 / scale, 18 / scale);
    }
  }

  private drawOrbit(
    radius: number,
    color: number,
    alpha: number,
    danger: number,
    clock: number,
    scale: number,
    reduced: boolean,
  ): void {
    const g = this.graphics,
      segments = 96;
    if (danger <= 0.5) {
      g.lineStyle((danger ? 1.6 : 1) / scale, color, alpha);
      g.strokeCircle(180, 260, radius);
      return;
    }
    g.lineStyle(1 / scale, color, alpha);
    for (let i = 0; i < segments; i++) {
      const broken = danger > 0.5 && (i + Math.floor(reduced ? 0 : clock * 4)) % 19 < 2;
      if (broken) continue;
      const a = (i * Math.PI * 2) / segments,
        b = ((i + 1) * Math.PI * 2) / segments;
      const jitter = !reduced && danger > 0.75 && i % 7 === 0 ? Math.sin(clock * 9 + i) / scale : 0;
      const p = orbit(a, radius + jitter),
        q = orbit(b, radius);
      g.lineBetween(
        Math.round(p.x * scale) / scale,
        Math.round(p.y * scale) / scale,
        Math.round(q.x * scale) / scale,
        Math.round(q.y * scale) / scale,
      );
    }
  }

  private drawTrail(
    angle: number,
    radius: number,
    length: number,
    color: number,
    scale: number,
    spiral = false,
  ): void {
    const g = this.graphics;
    for (let i = length; i > 0; i--) {
      const r = radius + (spiral ? i * 0.65 : 0);
      const p = orbit(angle - i * 0.035, r),
        q = orbit(angle - (i - 1) * 0.035, r);
      g.lineStyle((1 + 2 * (1 - i / length)) / scale, color, 0.65 * (1 - i / length));
      g.lineBetween(p.x, p.y, q.x, q.y);
    }
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

  private drawSingularity(radius: number, scale: number): void {
    const g = this.graphics;
    const r = Math.round(radius * scale) / scale;
    g.fillStyle(0x020306, 1);
    g.fillCircle(180, 260, r);
    g.lineStyle(1.8 / scale, WHITE, 0.85);
    g.strokeCircle(180, 260, r);
    g.lineStyle(3 / scale, GOLD, 0.08);
    g.strokeCircle(180, 260, r + 3 / scale);
  }

  private cover(width: number, height: number, alpha: number): void {
    if (alpha <= 0) return;
    this.effectGraphics.setPosition(0, 0).setScale(1).setDepth(3);
    this.effectGraphics.fillStyle(0x020306, alpha);
    this.effectGraphics.fillRect(0, 0, width, height);
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
      x: this.width / 2 + (point.x - 180) * this.worldScale + this.offset.x,
      y: this.centerY + (point.y - 260) * this.worldScale + this.offset.y,
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
    if (color !== BLUE) sprite.setTint(color);
    else sprite.clearTint();
  }
}
