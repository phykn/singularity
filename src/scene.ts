import Phaser from 'phaser';
import { numberText, rarityColors } from './rules.ts';
import { maxDamageNumbers } from './game.ts';
import { orbit, orbitRadius } from './geometry.ts';
import type { Point } from './geometry.ts';
import type { Effect, Game } from './game.ts';

const BLUE = 0x8CE8FB, WHITE = 0xF1FCFF, AMBER = 0xFFD08A, GOLD = 0xF9D894;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

export class ElectronScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
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
    this.damageText = this.add.group({
      classType: Phaser.GameObjects.Text, maxSize: maxDamageNumbers,
      createCallback: (child) => {
        const text = child as Phaser.GameObjects.Text;
        text.setStyle({ fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ecfbff', stroke: '#080a0e', strokeThickness: 3 });
        text.setOrigin(.5, 1).setDepth(1).setResolution(Math.min(devicePixelRatio || 1, 2));
      },
    });
  }

  update(): void {
    const g = this.graphics;
    if (!g) return;
    const model = this.model(), reduced = this.reduced();
    const width = this.scale.width, height = this.scale.height, scale = Math.min(width, height) / 360;
    this.damageText.children.forEach((child) => { child.setActive(false); (child as Phaser.GameObjects.Text).setVisible(false); });
    g.clear();
    if (model.phase === 'ready') {
      this.drawIntro(width, height, reduced);
      return;
    }
    g.setPosition(width / 2 - 180 * scale, height / 2 - 260 * scale);
    g.setScale(scale);
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

    for (let i = 0; i < 18; i++) {
      g.fillStyle(WHITE, (.06 + .04 * Math.sin(i + clock * .3)) * (1 - absorb));
      g.fillCircle((i * 137.51 + 21) % 356, 86 + (i * 91.73 + 18) % 346, .8);
    }

    if (!ending || success && absorb < 1) {
      if (model.radius < orbitRadius - 2) {
        g.lineStyle(.7 / scale, 0x343C48, .3 * (1 - absorb)); g.strokeCircle(180, 260, orbitRadius * (1 - absorb));
      }
      g.lineStyle((danger ? 1.6 : 1) / scale, danger ? AMBER : color, .38 * (1 - absorb));
      g.strokeCircle(180, 260, radius);
      for (let i = 0; i < 5; i++) {
        const point = orbit(-Math.PI / 2 + i * Math.PI * 2 / 5, radius);
        g.fillStyle(i < model.waveCount ? color : 0x47505E, 1 - absorb);
        g.fillCircle(point.x, point.y, 2 / scale);
      }
    }

    if (!ending && model.mass > 0) {
      const core = model.core, amount = Math.min(32, 6 + Math.floor(model.mass / 12));
      g.fillStyle(danger ? AMBER : BLUE, .025); g.fillCircle(180, 260, core + 14);
      g.lineStyle(.8 / scale, danger ? AMBER : color, .3); g.strokeCircle(180, 260, core);
      for (let i = 0; i < amount; i++) {
        const a = i * 2.39996 + clock * (.08 + i % 3 * .03), r = 3 + Math.sqrt((i + .5) / amount) * (core - 3);
        const p = orbit(a, r);
        g.fillStyle(i % 3 ? color : WHITE, .25 + (i % 4) * .14);
        g.fillCircle(p.x, p.y, (1 + (i % 3) * .3) / scale);
      }
      if (danger) { g.lineStyle(1 / scale, AMBER, .3); g.strokeCircle(180, 260, core + 4); }
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

    if (!ending && !collapsing) for (const mark of model.marks) {
      const ink = rarityColors[mark.rarity];
      g.fillStyle(ink, .045); g.fillCircle(mark.x, mark.y, mark.radius);
      g.lineStyle(.6 / scale, ink, .12); g.strokeCircle(mark.x, mark.y, mark.radius);
    }

    for (const target of model.targets) {
      const t = absorb ** 1.5, x = lerp(target.x, 180, t), y = lerp(target.y, 260, t);
      const size = Math.max(target.size * 2, (target.kind === 'small' ? 6 : 9) / scale) * (1 - absorb);
      if (size <= 0 || ending && !success) continue;
      const ink = target.kind === 'small' ? BLUE : AMBER;
      if (!reduced && !ending) {
        g.lineStyle(.7 / scale, ink, .2);
        g.lineBetween(x, y, x + Math.cos(target.angle) * 12, y + Math.sin(target.angle) * 12);
      }
      const hit = !reduced && target.hitAt !== undefined && model.time - target.hitAt < .1;
      g.lineStyle((target.kind === 'small' ? 1.2 : 1.5) / scale, ink, 1 - absorb);
      g.strokeRect(x - size / 2, y - size / 2, size, size);
      g.fillStyle(hit ? WHITE : ink, hit ? .8 : .12); g.fillRect(x - size / 2, y - size / 2, size, size);
      if (target.kind === 'dense') {
        const hp = Math.ceil(target.hp / target.maxHp * 4);
        for (let i = 0; i < 4; i++) {
          g.fillStyle(ink, i < hp ? .9 : .15); g.fillCircle(x - 6 / scale + i * 4 / scale, y - size / 2 - 4 / scale, 1.1 / scale);
        }
      } else if (target.hp < target.maxHp) {
        g.lineStyle(1.3 / scale, ink, .9); g.lineBetween(x - size / 2, y - size / 2 - 3 / scale, x - size / 2 + size * target.hp / target.maxHp, y - size / 2 - 3 / scale);
      }
    }

    if (!ending) for (const fx of model.effects.slice(reduced ? -35 : -120)) this.drawEffect(fx, model.seconds, scale, reduced);

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
      }
      return;
    }

    const electron = orbit(angle, radius), tail = reduced ? 5 : 10 + model.boosts.accel * 7;
    const satellites = model.forms.satellite.count;
    for (let i = tail; i > 0; i--) {
      const p = orbit(angle - i * .035, radius), next = orbit(angle - (i - 1) * .035, radius);
      g.lineStyle((1 + 2 * (1 - i / tail)) / scale, color, .65 * (1 - i / tail));
      g.lineBetween(p.x, p.y, next.x, next.y);
    }
    if (!collapsing) for (let i = 0; i < satellites; i++) {
      const a = clock * 2 + i * Math.PI * 2 / satellites;
      g.lineStyle(.7 / scale, color, .18); g.strokeCircle(electron.x, electron.y, 15);
      g.fillStyle(color, .8); g.fillCircle(electron.x + Math.cos(a) * 15, electron.y + Math.sin(a) * 15, 2.3 / scale);
    }
    if (collapsing && model.mass === 0) this.drawElectron(orbit(angle + Math.PI, radius), 1, scale, color);
    this.drawElectron(electron, 1, scale, color);
    if (!collapsing) this.drawDamage(model, width, height, scale, reduced);
  }

  private drawDamage(model: Game, width: number, height: number, scale: number, reduced: boolean): void {
    const numbers = reduced ? model.damageNumbers.slice(-24) : model.damageNumbers;
    for (const damage of numbers) {
      const age = model.seconds - damage.born;
      if (reduced && age > .4) continue;
      const text = this.damageText.get(0, 0, '') as Phaser.GameObjects.Text | null;
      if (!text) break;
      const lane = damage.id % 3 - 1;
      const x = width / 2 + (damage.x - 180) * scale + lane * 8;
      const y = height / 2 + (damage.y - 260) * scale - 8 - (reduced ? 0 : age * 32);
      text.setActive(true).setVisible(true).setText(numberText(damage.value));
      text.setPosition(Math.max(16, Math.min(width - 16, x)), Math.max(22, Math.min(height - 4, y)));
      text.setColor(damage.value >= 5 ? '#ffda96' : damage.value > 2 ? '#f1fcff' : '#b8eefb');
      text.setScale(reduced ? 1 : 1 + .16 * Math.exp(-age * 16));
      text.setAlpha(reduced ? 1 : 1 - clamp((age - .35) / .37));
    }
  }

  private drawIntro(width: number, height: number, reduced: boolean): void {
    const g = this.graphics, clock = reduced ? 0 : this.time.now / 1000;
    const x = width / 2, y = height * .51;
    const radius = Math.min(width * .44, height * .45, 184), core = radius * .42;
    g.setPosition(0, 0); g.setScale(1);

    for (let i = 0; i < 16; i++) {
      g.fillStyle(0xA5C1D6, .12 + i % 3 * .06);
      g.fillCircle((i * 137.51 + 31) % width, (i * 91.73 + 19) % height, i % 4 === 0 ? .8 : .5);
    }
    for (const fraction of [.72, 1]) {
      g.lineStyle(.7, 0x7295AF, fraction === 1 ? .27 : .12);
      g.strokeCircle(x, y, radius * fraction);
    }

    for (let i = 18; i > 0; i--) {
      g.fillStyle(0x5898C5, .012);
      g.fillCircle(x, y, core + i * radius * .012);
    }
    g.fillStyle(0x04060A, 1); g.fillCircle(x, y, core);
    g.lineStyle(.8, 0xA7C4D9, .3); g.strokeCircle(x, y, core);
    for (let i = 0; i < 96; i++) {
      const a = i / 96 * Math.PI * 2, next = (i + 1) / 96 * Math.PI * 2;
      const light = (.5 + .5 * Math.cos(a + 2.2 + clock * .07)) ** 5;
      for (const [stroke, alpha, ink] of [[9, .07, BLUE], [3, .22, BLUE], [1.1, .9, WHITE]]) {
        g.lineStyle(stroke, ink, alpha * light);
        g.lineBetween(x + Math.cos(a) * core, y + Math.sin(a) * core, x + Math.cos(next) * core, y + Math.sin(next) * core);
      }
    }

    for (let i = 0; i < 7; i++) {
      const phase = (i / 7 + clock * .018) % 1;
      const r = radius * (.52 + .39 * (1 - phase)), a = i * 2.39996 + clock * .11;
      g.fillStyle(0x9CD9ED, Math.sin(phase * Math.PI) * .35);
      g.fillCircle(x + Math.cos(a) * r, y + Math.sin(a) * r, .8);
    }

    const angle = -.65 + clock * .24;
    for (let i = 36; i > 0; i--) {
      const a = angle - i * .022, next = angle - (i - 1) * .022;
      g.lineStyle(1.5, BLUE, (1 - i / 36) * .7);
      g.lineBetween(x + Math.cos(a) * radius, y + Math.sin(a) * radius, x + Math.cos(next) * radius, y + Math.sin(next) * radius);
    }
    const electron = { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
    for (const [size, alpha] of [[18, .035], [10, .08], [5, .2]]) {
      g.fillStyle(BLUE, alpha); g.fillCircle(electron.x, electron.y, size);
    }
    g.fillStyle(WHITE, 1); g.fillCircle(electron.x, electron.y, 2.6);
  }

  private drawElectron(point: Point, alpha: number, scale: number, color = BLUE): void {
    const g = this.graphics;
    g.fillStyle(color, 0.035 * alpha); g.fillCircle(point.x, point.y, 22 / scale);
    g.fillStyle(color, 0.10 * alpha); g.fillCircle(point.x, point.y, 12 / scale);
    g.fillStyle(color, 0.20 * alpha); g.fillCircle(point.x, point.y, 7 / scale);
    g.fillStyle(WHITE, alpha); g.fillCircle(point.x, point.y, Math.max(4, 4 / scale));
  }

  private drawEffect(fx: Effect, time: number, scale: number, reduced: boolean): void {
    const g = this.graphics;
    const t = clamp((time - fx.born) / (fx.life * (reduced ? 0.7 : 1)));
    if (t >= 1) return;
    const alpha = Math.pow(1 - t, 0.7), ink = rarityColors[fx.rarity];
    if (fx.kind === 'bolt') {
      const points = [fx.from];
      for (let i = 1; i < 6; i++) {
        const shift = reduced ? 0 : Math.sin(fx.from.x * 3 + fx.to.y * 7 + i * 11 + fx.born * 100) * 5;
        points.push({ x: lerp(fx.from.x, fx.to.x, i / 6) + shift, y: lerp(fx.from.y, fx.to.y, i / 6) - shift });
      }
      points.push(fx.to);
      for (const [width, opacity] of [[12, 0.08], [4, 0.4], [1.6, 1]]) {
        g.lineStyle(width * Math.max(1, fx.width / 1.8) / scale, width === 1.6 ? WHITE : ink, opacity * alpha);
        g.beginPath(); g.moveTo(points[0].x, points[0].y); points.slice(1).forEach((p) => g.lineTo(p.x, p.y)); g.strokePath();
      }
    } else if (fx.kind === 'pierce') {
      g.lineStyle(fx.width, ink, 0.13 * alpha); g.lineBetween(fx.from.x, fx.from.y, fx.to.x, fx.to.y);
      g.lineStyle(1.8 / scale, WHITE, alpha); g.lineBetween(fx.from.x, fx.from.y, fx.to.x, fx.to.y);
    } else if (fx.kind === 'absorb') {
      g.lineStyle(1.2 / scale, AMBER, alpha * .65); g.strokeCircle(180, 260, fx.radius * (.7 + t * .5));
      g.fillStyle(AMBER, .05 * alpha); g.fillCircle(180, 260, fx.radius);
    } else if (fx.kind === 'kill') {
      g.fillStyle(ink, alpha);
      const x = lerp(fx.from.x, fx.to.x, t * t), y = lerp(fx.from.y, fx.to.y, t * t);
      g.fillCircle(x, y, 2 / scale);
      if (!reduced) {
        g.lineStyle(1.2 / scale, ink, alpha * 0.5);
        g.strokeCircle(fx.from.x, fx.from.y, (4 + t * 17) / scale);
        g.fillStyle(WHITE, alpha * 0.8); g.fillCircle(fx.from.x, fx.from.y, (1 - t) * 4 / scale);
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3 + fx.born * 7;
          const radius = (5 + t * 24) / scale;
          g.lineStyle(1.5 / scale, i % 2 ? WHITE : ink, alpha);
          g.lineBetween(fx.from.x + Math.cos(angle) * radius, fx.from.y + Math.sin(angle) * radius, fx.from.x + Math.cos(angle) * (radius + 4 / scale), fx.from.y + Math.sin(angle) * (radius + 4 / scale));
        }
      }
    } else {
      const radius = fx.radius * (0.25 + 0.75 * t);
      g.fillStyle(ink, alpha * 0.035); g.fillCircle(fx.from.x, fx.from.y, radius);
      g.lineStyle(1.5 / scale, fx.kind === 'burst' ? WHITE : ink, alpha * 0.85); g.strokeCircle(fx.from.x, fx.from.y, radius);
      if (fx.kind === 'burst' && !reduced) for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        g.lineBetween(fx.from.x + Math.cos(angle) * radius * 0.8, fx.from.y + Math.sin(angle) * radius * 0.8, fx.from.x + Math.cos(angle + 0.08) * radius * 1.12, fx.from.y + Math.sin(angle + 0.08) * radius * 1.12);
      }
    }
  }
}
