import Phaser from 'phaser';
import { createPixels, particleColors } from './pixels.ts';
import { effectOrigin, visibleEffects } from './effects.ts';
import { numberText } from './rules.ts';
import { maxDamageNumbers } from './game.ts';
import { orbit } from './geometry.ts';
import type { Point } from './geometry.ts';
import type { Effect, Game } from './game.ts';

const BLUE = 0x8CE8FB, WHITE = 0xF1FCFF, AMBER = 0xFFD08A, GOLD = 0xF9D894;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

export class ElectronScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private effectGraphics!: Phaser.GameObjects.Graphics;
  private sprites!: Phaser.GameObjects.Group;
  private width = 0;
  private centerY = 0;
  private worldScale = 1;
  private damageText!: Phaser.GameObjects.Group;
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
    this.sprites = this.add.group({ classType: Phaser.GameObjects.Image });
    this.damageText = this.add.group({
      classType: Phaser.GameObjects.Text, maxSize: maxDamageNumbers,
      createCallback: (child) => {
        const text = child as Phaser.GameObjects.Text;
        text.setStyle({ fontFamily: 'Singularity Pixel, monospace', fontSize: '12px', color: '#ecfbff', stroke: '#080a0e', strokeThickness: 2 });
        text.setOrigin(.5, 1).setDepth(3).setResolution(1);
      },
    });
  }

  update(): void {
    const g = this.graphics;
    if (!g) return;
    const model = this.model(), reduced = this.reduced();
    const width = this.scale.width, height = this.scale.height, scale = Math.min(width, height) / 360;
    this.damageText.children.forEach((child) => { child.setActive(false); (child as Phaser.GameObjects.Text).setVisible(false); });
    this.sprites.children.forEach(child => { child.setActive(false); (child as Phaser.GameObjects.Image).setVisible(false); });
    this.effectGraphics.clear();
    g.clear();
    this.width = width; this.worldScale = scale;
    this.centerY = height > width ? Math.max(170 * scale + 8, height * .42) : height / 2;
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
    const angle = model.angle + (collapsing ? progress * progress * Math.PI * 5 : 0);
    const radius = collapsing ? model.radius * (1 - progress ** 1.5) : model.radius * (1 - absorb);

    if (!ending || success && absorb < 1) {
      g.lineStyle((danger ? 1.6 : 1) / scale, danger ? AMBER : color, .38 * (1 - absorb));
      g.strokeCircle(180, 260, radius);
    }

    if (!ending && model.mass > 0) {
      const core = model.core;
      this.drawCore(core, scale);
      if (danger) {
        g.lineStyle(2 / scale, AMBER, reduced ? .85 : .65 + .25 * Math.sin(clock * 6));
        g.beginPath();
        for (let i = 0; i <= 12; i++) {
          const p = orbit(angle - .4 + i / 12 * .8, core + 4 / scale);
          if (!i) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
        }
        g.strokePath();
      }
    }

    const warning = model.warningWave;
    if (warning) {
      for (const offset of [0, Math.PI]) {
        g.lineStyle(2 / scale, AMBER, reduced ? .65 : .4 + .3 * Math.sin(clock * 5));
        g.beginPath();
        for (let i = 0; i <= 16; i++) {
          const p = orbit(warning.angle + offset - .25 + i / 16 * .5, 172);
          if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
        }
        g.strokePath();
      }
    }

    for (const target of model.targets) {
      const t = absorb ** 1.5, x = lerp(target.x, 180, t), y = lerp(target.y, 260, t);
      const size = Math.max(target.size * 2, (target.kind === 'small' ? 6 : 9) / scale) * (1 - absorb);
      if (size <= 0 || ending && !success) continue;
      const ink = particleColors[target.particle];
      const hit = !reduced && target.hitAt !== undefined && model.time - target.hitAt < .1;
      const point = this.screen({ x, y });
      const sprite = this.sprite(point, target.particle, 1, 1 - absorb);
      if (hit) { sprite.setTint(WHITE); sprite.setTintFill(); } else sprite.clearTint();
      if (target.kind === 'dense') {
        const hp = Math.ceil(target.hp / target.maxHp * 4);
        for (let i = 0; i < 4; i++) {
          g.fillStyle(ink, i < hp ? .9 : .15); g.fillRect(x - 7 / scale + i * 4 / scale, y - 13 / scale, 2 / scale, 2 / scale);
        }
      } else if (target.hp < target.maxHp) {
        g.lineStyle(1.3 / scale, ink, .9); g.lineBetween(x - size / 2, y - size / 2 - 3 / scale, x - size / 2 + size * target.hp / target.maxHp, y - size / 2 - 3 / scale);
      }
    }

    if (!ending) for (const fx of visibleEffects(model.effects, reduced)) this.drawEffect(fx, model.seconds, scale, reduced, model.position);

    if (ending) {
      if (success) {
        const r = 4 + progress ** 2 * 390;
        for (let ring = 3; ring > 0; ring--) { g.lineStyle((5 + ring * 4) / scale, color, .04 / ring); g.strokeCircle(180, 260, r + ring * 5); }
        g.fillStyle(0x030407, 1); g.fillCircle(180, 260, r);
        g.lineStyle(1.8 / scale, WHITE, .85); g.strokeCircle(180, 260, r);
        if (!reduced && progress < .8) for (let i = 0; i < 12; i++) {
          const a = i * Math.PI / 6 + clock * .3;
          g.lineStyle(1 / scale, color, .16 * (1 - absorb));
          g.lineBetween(180 + Math.cos(a) * (r + 5), 260 + Math.sin(a) * (r + 5), 180 + Math.cos(a + .2) * (r + 45), 260 + Math.sin(a + .2) * (r + 45));
        }
      } else {
        g.lineStyle(2 / scale, WHITE, 1 - progress);
        g.strokeCircle(180, 260, 4 + Math.sin(progress * Math.PI) * 15);
        g.fillStyle(WHITE, (1 - progress) ** 3); g.fillCircle(180, 260, 4);
        for (let i = 0; i < 8; i++) {
          const p = orbit(i * Math.PI / 4, 5 + progress * 35);
          g.fillStyle(WHITE, 1 - progress); g.fillRect(p.x, p.y, 2 / scale, 2 / scale);
        }
      }
      return;
    }

    const electron = orbit(angle, radius), tail = reduced ? 5 : 10 + model.boosts.accel * 7;
    for (let i = tail; i > 0; i--) {
      const p = orbit(angle - i * .035, radius), next = orbit(angle - (i - 1) * .035, radius);
      g.lineStyle((1 + 2 * (1 - i / tail)) / scale, color, .65 * (1 - i / tail));
      g.lineBetween(p.x, p.y, next.x, next.y);
    }
    if (collapsing && model.mass === 0) this.drawElectron(orbit(angle + Math.PI, radius), 1, scale, color);
    this.drawElectron(electron, 1, scale, color);
    if (!collapsing) this.drawDamage(model, width, height, scale, reduced);
  }

  private drawCore(radius: number, scale: number): void {
    const g = this.graphics, pixel = 2 / scale;
    const point = ([x, y]: number[]) => new Phaser.Math.Vector2(180 + Math.round(x * radius / pixel) * pixel, 260 + Math.round(y * radius / pixel) * pixel);
    const hull = [[-.84,-.4],[-.52,-.79],[-.1,-.94],[.36,-.88],[.69,-.6],[.94,-.13],[.78,.37],[.4,.82],[-.12,.96],[-.54,.71],[-.89,.23]];
    const facets = [
      { ink: 0x344D60, points: [hull[0],hull[1],hull[2],hull[3],[.18,-.2],[-.3,.06],hull[10]] },
      { ink: 0x47687A, points: [hull[1],hull[2],hull[3],[-.08,-.49],[-.3,-.12],hull[0]] },
      { ink: 0x182A37, points: [[.18,-.2],hull[3],hull[4],hull[5],[.46,.2],[.07,.31]] },
      { ink: 0x385464, points: [hull[5],hull[6],hull[7],[.11,.62],[.07,.31],[.46,.2]] },
      { ink: 0x142431, points: [hull[7],hull[8],hull[9],hull[10],[-.35,.24],[.11,.62]] },
      { ink: 0x526F80, points: [[-.35,.24],[-.3,.06],[.18,-.2],[.07,.31],[-.12,.47]] },
    ];
    g.fillStyle(0x263E4C, 1); g.fillPoints(hull.map(point), true);
    for (const facet of facets) { g.fillStyle(facet.ink, 1); g.fillPoints(facet.points.map(point), true); }
    g.lineStyle(pixel, 0x91B6C6, .75); g.strokePoints([hull[0],hull[1],hull[2]].map(point), false);
    g.lineStyle(pixel, 0x62889B, .6); g.strokePoints([hull[5],hull[6],hull[7]].map(point), false);
  }

  private drawDamage(model: Game, width: number, height: number, scale: number, reduced: boolean): void {
    const numbers = model.damageNumbers.slice(-maxDamageNumbers).reverse();
    const occupied: Phaser.Geom.Rectangle[] = [], limit = reduced ? 12 : 24;
    for (const damage of numbers) {
      const age = model.seconds - damage.born;
      if (reduced && age > .4 || occupied.length >= limit) continue;
      const text = this.damageText.get(0, 0, '') as Phaser.GameObjects.Text;
      const x = width / 2 + (damage.x - 180) * scale;
      const y = this.centerY + (damage.y - 260) * scale - 4 - (reduced ? 0 : age * 16);
      text.setText(numberText(damage.value)).setScale(1);
      let placed = false;
      for (const [dx, dy] of [[0, 0], [0, -10], [-12, -6], [12, -6], [-16, -16], [16, -16]]) {
        text.setPosition(Math.round(Math.max(10, Math.min(width - 10, x + dx))), Math.round(Math.max(12, Math.min(height - 2, y + dy))));
        const bounds = text.getBounds(); Phaser.Geom.Rectangle.Inflate(bounds, 1, 1);
        if (occupied.some(previous => Phaser.Geom.Intersects.RectangleToRectangle(bounds, previous))) continue;
        occupied.push(bounds); placed = true; break;
      }
      text.setActive(placed).setVisible(placed);
      if (!placed) continue;
      text.setColor(damage.value >= 5 ? '#ffda96' : damage.value > 2 ? '#f1fcff' : '#b8eefb');
      text.setAlpha(reduced ? 1 : 1 - clamp((age - .35) / .37));
    }
  }

  private drawIntro(width: number, height: number, reduced: boolean): void {
    const g = this.graphics, clock = reduced ? 0 : this.time.now / 1000;
    const x = width / 2, y = height * .51;
    const radius = Math.min(width * .44, height * .45, 184), core = radius * .42;
    g.setPosition(0, 0); g.setScale(1);

    g.lineStyle(1, 0x7295AF, .4); g.strokeCircle(x, y, radius);
    g.fillStyle(0x04060A, 1); g.fillCircle(x, y, core);
    g.lineStyle(.8, 0xA7C4D9, .3); g.strokeCircle(x, y, core);
    for (let i = 0; i < 96; i++) {
      const a = i / 96 * Math.PI * 2, next = (i + 1) / 96 * Math.PI * 2;
      const light = (.5 + .5 * Math.cos(a + 2.2 + clock * .07)) ** 5;
      for (const [stroke, alpha, ink] of [[5, .13, BLUE], [3, .35, BLUE], [1, 1, WHITE]]) {
        g.lineStyle(stroke, ink, alpha * light);
        g.lineBetween(x + Math.cos(a) * core, y + Math.sin(a) * core, x + Math.cos(next) * core, y + Math.sin(next) * core);
      }
    }

    const angle = -.65 + clock * .24;
    for (let i = 36; i > 0; i--) {
      const a = angle - i * .022, next = angle - (i - 1) * .022;
      g.lineStyle(1.5, BLUE, (1 - i / 36) * .7);
      g.lineBetween(x + Math.cos(a) * radius, y + Math.sin(a) * radius, x + Math.cos(next) * radius, y + Math.sin(next) * radius);
    }
    const electron = { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
    this.sprite(electron, 'electron', 1, 1, 2).clearTint();
  }

  private screen(point: Point): Point {
    return { x: this.width / 2 + (point.x - 180) * this.worldScale, y: this.centerY + (point.y - 260) * this.worldScale };
  }

  private sprite(point: Point, key: string, scale: number, alpha = 1, depth = .5): Phaser.GameObjects.Image {
    const sprite = this.sprites.get(point.x, point.y, key) as Phaser.GameObjects.Image;
    return sprite.setActive(true).setVisible(true).setTexture(key).setPosition(Math.round(point.x), Math.round(point.y)).setScale(scale).setAlpha(alpha).setDepth(depth).clearTint();
  }

  private drawElectron(point: Point, alpha: number, scale: number, color = BLUE): void {
    const sprite = this.sprite(this.screen(point), 'electron', 1, alpha, 2);
    if (color === GOLD) sprite.setTint(GOLD); else sprite.clearTint();
  }

  private drawEffect(fx: Effect, time: number, scale: number, reduced: boolean, electron: Point): void {
    const g = this.effectGraphics;
    const from = effectOrigin(fx, electron);
    const to = fx.kind === 'pierce' ? { x: from.x + fx.to.x - fx.from.x, y: from.y + fx.to.y - fx.from.y }
      : fx.kind === 'focus' ? this.model().targets.find(target => target.id === fx.targetId) ?? fx.to : fx.to;
    const t = clamp((time - fx.born) / fx.life);
    if (t >= 1) return;
    const alpha = Math.pow(1 - t, 0.7), ink = BLUE;
    if (fx.kind === 'wave') {
      g.lineStyle(2 / scale, ink, .8); g.strokeCircle(from.x, from.y, fx.radius * t);
      if (!reduced) { g.lineStyle(1 / scale, WHITE, .65); g.strokeCircle(from.x, from.y, Math.max(0, fx.radius * t - 3 / scale)); }
    } else if (fx.kind === 'whip') {
      const start = Math.atan2(fx.to.y - fx.from.y, fx.to.x - fx.from.x), angle = start + fx.width * t;
      const end = { x: from.x + Math.cos(angle) * fx.radius, y: from.y + Math.sin(angle) * fx.radius };
      g.lineStyle(2 / scale, WHITE, .95);
      g.beginPath(); g.moveTo(from.x, from.y);
      for (let i = 1; i <= 8; i++) {
        const offset = i % 2 && !reduced ? 3 : 0;
        g.lineTo(lerp(from.x, end.x, i / 8) + Math.sin(angle) * offset, lerp(from.y, end.y, i / 8) - Math.cos(angle) * offset);
      }
      g.strokePath();
      g.lineStyle(1 / scale, ink, .45); g.beginPath();
      for (let i = 0; i <= 16; i++) {
        const a = start + fx.width * t * i / 16;
        const x = from.x + Math.cos(a) * fx.radius, y = from.y + Math.sin(a) * fx.radius;
        if (!i) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokePath();
    } else if (fx.kind === 'bolt' || fx.kind === 'strike' || fx.kind === 'focus') {
      const points = [from];
      for (let i = 1; i < 6; i++) {
        const shift = reduced ? 0 : Math.sin(from.x * 3 + to.y * 7 + i * 11 + fx.born * 100) * 5;
        points.push({ x: lerp(from.x, to.x, i / 6) + shift, y: lerp(from.y, to.y, i / 6) - shift });
      }
      points.push(to);
      for (const [width, opacity] of [[4, .16], [2, .6], [1, 1]]) {
        g.lineStyle(width * Math.min(2, Math.max(1, fx.width / 1.8)) / scale, width === 1 ? WHITE : ink, opacity * (fx.kind === 'focus' ? 1 : alpha));
        g.beginPath(); g.moveTo(points[0].x, points[0].y); points.slice(1).forEach((p) => g.lineTo(p.x, p.y)); g.strokePath();
      }
      if (fx.kind === 'strike') {
        g.lineStyle(1 / scale, WHITE, alpha); g.strokeCircle(to.x, to.y, fx.radius);
        g.fillStyle(ink, .12 * alpha); g.fillCircle(to.x, to.y, fx.radius);
      }
    } else if (fx.kind === 'pierce') {
      g.lineStyle(fx.width, ink, 0.13 * alpha); g.lineBetween(from.x, from.y, to.x, to.y);
      g.lineStyle(1.8 / scale, WHITE, alpha); g.lineBetween(from.x, from.y, to.x, to.y);
    } else if (fx.kind === 'absorb') {
      const x = lerp(from.x, 180, Math.min(1, t * 2)), y = lerp(from.y, 260, Math.min(1, t * 2));
      g.fillStyle(AMBER, alpha); g.fillRect(x - 2 / scale, y - 2 / scale, 4 / scale, 4 / scale);
      g.lineStyle(1 / scale, AMBER, alpha * .7); g.strokeCircle(180, 260, fx.radius * (1.25 - t * .5));
    } else if (fx.kind === 'kill') {
      g.fillStyle(ink, alpha);
      const x = lerp(from.x, to.x, t * t), y = lerp(from.y, to.y, t * t);
      g.fillCircle(x, y, 2 / scale);
      if (!reduced) {
        g.lineStyle(1.2 / scale, ink, alpha * 0.5);
        g.strokeCircle(from.x, from.y, (4 + t * 17) / scale);
        g.fillStyle(WHITE, alpha * 0.8); g.fillCircle(from.x, from.y, (1 - t) * 4 / scale);
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3 + fx.born * 7;
          const radius = (5 + t * 24) / scale;
          g.lineStyle(.7 / scale, i % 2 ? WHITE : ink, alpha);
          g.lineBetween(from.x + Math.cos(angle) * radius, from.y + Math.sin(angle) * radius, from.x + Math.cos(angle) * (radius + 4 / scale), from.y + Math.sin(angle) * (radius + 4 / scale));
        }
      }
    } else {
      const radius = fx.radius * (0.25 + 0.75 * t);
      g.fillStyle(ink, alpha * 0.035); g.fillCircle(from.x, from.y, radius);
      g.lineStyle(.7 / scale, ink, alpha * (fx.kind === 'area' ? .16 : .45)); g.strokeCircle(from.x, from.y, radius);
    }
  }
}
