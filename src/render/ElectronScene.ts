import Phaser from 'phaser';
import { createParticleTextures } from './particleTextures.ts';
import { SpritePool } from './SpritePool.ts';
import { healthBar } from './healthBars.ts';
import { endingFrame } from './ending.ts';
import { introFrame } from './intro.ts';
import { beyondFrame } from './beyond.ts';
import { beamFrame, beamPose, effectFrame, visibleEffects } from './effects.ts';
import type { EffectPainter } from './effects.ts';
import effectsUrl from '../art/assets/effects.png';
import beamsUrl from '../art/assets/beams.png';
import { DamageLabels } from './DamageLabels.ts';
import { orbit, clamp } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import type { Game } from '../game/Game.ts';
import { BLUE, WHITE, AMBER, GOLD, skillColors } from '../art/palette.ts';
import { drawEffect } from './drawEffects.ts';
import { drawWaveWarning } from './warning.ts';
import { drawElectronField } from './electronField.ts';
export class ElectronScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private effectGraphics!: Phaser.GameObjects.Graphics;
  private sprites!: SpritePool;
  private contacts = new Map<
    string,
    { point: Point; color: number; alpha: number; radius: number }
  >();
  private impactAt = -Infinity;
  private lastModel: Game | null = null;
  private returnAt = -Infinity;
  private beganAt = -Infinity;
  private launchPending = false;
  private offset = { x: 0, y: 0 };
  private width = 0;
  private centerY = 0;
  private worldScale = 1;
  private damageLabels!: DamageLabels;
  private getGame: () => Game;
  private getLaunch: () => number | null;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  constructor(getGame: () => Game, getLaunch: () => number | null) {
    super('electron');
    this.getGame = getGame;
    this.getLaunch = getLaunch;
  }
  preload(): void {
    this.load.spritesheet('effects', effectsUrl, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('beams', beamsUrl, { frameWidth: 64, frameHeight: 16 });
  }
  create(): void {
    this.graphics = this.add.graphics();
    this.effectGraphics = this.add.graphics().setDepth(1);
    createParticleTextures(this);
    this.sprites = new SpritePool(this.add);
    this.damageLabels = new DamageLabels(this.add);
  }
  update(): void {
    if (!this.graphics) return;
    this.contacts.clear();
    this.sprites.begin();
    this.drawFrame();
    this.sprites.end();
  }
  private drawFrame(): void {
    const g = this.graphics;
    const game = this.getGame();
    const width = this.scale.width,
      height = this.scale.height,
      scale = Math.min(width, height) / 360;
    if (game.phase !== 'running') this.damageLabels.hide();
    this.effectGraphics.clear();
    g.clear();
    this.width = width;
    this.worldScale = scale;
    this.centerY = height > width ? Math.max(170 * scale + 8, height * 0.42) : height / 2;
    if (this.lastModel !== game) {
      this.returnAt =
        game.phase === 'ready' && this.lastModel?.result?.outcome === 'success'
          ? this.time.now
          : -Infinity;
      this.lastModel = game;
      this.impactAt = -Infinity;
      this.beganAt = -Infinity;
      this.launchPending = false;
    }
    if (game.phase === 'ready') {
      this.launchPending = this.getLaunch() !== null;
      this.offset = { x: 0, y: 0 };
      this.drawIntro(width, height);
      this.cover(width, height, 1 - clamp((this.time.now - this.returnAt) / 550));
      return;
    }
    if (this.launchPending) {
      this.beganAt = this.time.now;
      this.launchPending = false;
    }
    g.setPosition(width / 2 - 180 * scale, this.centerY - 260 * scale);
    g.setScale(scale);
    this.effectGraphics.setPosition(g.x, g.y).setScale(scale).setDepth(1);
    const crossing = beyondFrame(game, this.reducedMotion.matches);
    if (crossing) {
      this.offset = { x: 0, y: 0 };
      this.drawBeyond(crossing, scale, game.seed);
      return;
    }
    const ending = endingFrame(game),
      clock = game.seconds;
    const danger = !game.charged && game.margin < game.rules.dangerMargin;
    const color = game.charged ? GOLD : BLUE;
    const orbitColor = game.endless ? 0xb0a0ff : color;
    const position = game.position,
      damage = game.damage;
    if (!ending && clock - this.impactAt > 0.65) {
      for (let i = game.effects.length - 1; i >= 0; i--) {
        const fx = game.effects[i];
        if (clock - fx.born >= 0.05) break;
        if (fx.kind === 'strike' || (fx.source === 'charge' && fx.kind === 'bolt')) {
          this.impactAt = clock;
          break;
        }
      }
    }
    const impactAge = clock - this.impactAt;
    this.offset =
      !ending && !this.reducedMotion.matches && impactAge < 0.06
        ? { x: impactAge < 0.03 ? 1 : -1, y: 1 }
        : { x: 0, y: 0 };
    g.setPosition(g.x + this.offset.x, g.y + this.offset.y);
    this.effectGraphics.setPosition(g.x, g.y);
    const radius = ending?.electron ? ending.radius : game.radius;
    if (!ending || ending.electron || !ending.success) {
      const unstable = danger || ending?.success === false;
      const opacity = ending && !ending.electron ? 0.12 : danger ? 0.8 : 0.32;
      this.drawOrbit(radius, unstable ? AMBER : orbitColor, opacity, unstable, scale);
    }
    if (game.mass > 0 && (!ending || !ending.success || ending.electron))
      this.drawCore(game.core * (ending?.success ? 1 - ending.absorb * 0.7 : 1), scale);
    const warning = game.warningWave;
    if (warning)
      drawWaveWarning(
        g,
        warning.angle,
        game.time - warning.time + game.rules.waveWarningSeconds,
        scale,
      );
    for (const target of game.targets) {
      if (ending && !ending.success && !ending.electron) continue;
      const absorb = ending?.absorb ?? 0;
      if (absorb >= 0.99) continue;
      const p = ending?.success
        ? orbit(target.angle + absorb * absorb * Math.PI * 2, target.radius * (1 - absorb) ** 1.5)
        : target;
      const point = this.screen(p);
      if (point.x < -20 || point.x > width + 20 || point.y < -20 || point.y > height + 20) continue;
      const hit = !ending && target.hitAt !== undefined && game.time - target.hitAt < 0.06;
      const sprite = this.sprites.draw(point, target.particle, 1, 1 - absorb);
      if (hit) sprite.setTint(WHITE).setTintMode(Phaser.TintModes.FILL);
      else sprite.clearTint();
      const bar = !ending && healthBar(target, damage);
      if (bar) {
        const left = (Math.round(point.x) - Math.floor(bar.width / 2) - g.x) / scale;
        const top = (Math.round(point.y) - bar.offset - g.y) / scale;
        if (bar.filled < bar.width) {
          g.fillStyle(0x492129, 1);
          g.fillRect(left, top, bar.width / scale, bar.height / scale);
        }
        g.fillStyle(bar.filled < bar.width ? 0xe4938c : 0xa7656b, 0.85);
        g.fillRect(left, top, bar.filled / scale, bar.height / scale);
      }
    }
    if (!ending) {
      const satellites = game.combat.satellitePoints;
      for (const point of satellites)
        this.sprites.draw(this.screen(point), 'electron', 0.5, 1).clearTint();
      for (const fx of visibleEffects(game.effects))
        drawEffect(
          this.effectGraphics,
          fx,
          clock,
          scale,
          position,
          game.targets,
          this.paint,
          game.radius,
          satellites,
        );
      for (const { point, color, alpha, radius } of this.contacts.values()) {
        this.effectGraphics.lineStyle(1 / scale, color, alpha * 0.65);
        this.effectGraphics.strokeCircle(point.x, point.y, radius / scale);
      }
      const surging = game.combat.status('surge').active;
      if (game.ranks.charge || surging)
        drawElectronField(
          this.effectGraphics,
          position,
          clock,
          scale,
          game.combat.status('charge'),
          surging,
          game.ranks.charge,
          game.ranks.surge,
        );
      this.drawTrail(
        game.angle,
        game.radius,
        surging ? 12 : 8,
        surging ? skillColors.surge : color,
        scale,
      );
      this.drawElectron(position, 1, color, surging);
      this.damageLabels.draw(game, width, height, this.centerY, scale);
      this.cover(width, height, 0.5 * (1 - clamp((this.time.now - this.beganAt) / 160)));
      return;
    }
    if (ending.electron) {
      this.drawTrail(ending.angle, ending.radius, 34, ending.success ? GOLD : AMBER, scale, true);
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
      this.drawSingularity(24, scale);
      this.cover(width, height, 1 - ending.reveal);
      return;
    }
    if (ending.stage === 'impact') {
      const t = clamp((game.phaseProgress * game.rules.failureEndingSeconds) / 0.2);
      g.lineStyle(1 / scale, AMBER, 0.55 * (1 - t));
      g.strokeCircle(180, 260, Math.round(8 * (1 - t) + 2) / scale);
      g.fillStyle(WHITE, 0.6 * (1 - t) ** 2);
      g.fillCircle(180, 260, 2 / scale);
    }
    if (ending.success && ending.flash) {
      g.fillStyle(WHITE, ending.flash * 0.6);
      g.fillCircle(180, 260, 5 / scale);
    }
  }
  private drawPixelRing(radius: number, ink: number, alpha: number, scale: number): void {
    const pixel = 2 / scale;
    const points = Array.from({ length: 65 }, (_, i) => {
      const a = (i * Math.PI) / 32;
      return new Phaser.Math.Vector2(
        180 + Math.round((Math.cos(a) * radius) / pixel) * pixel,
        260 + Math.round((Math.sin(a) * radius) / pixel) * pixel,
      );
    });
    this.graphics.lineStyle(1 / scale, ink, alpha);
    this.graphics.strokePoints(points, true);
  }

  private drawBeyond(
    frame: NonNullable<ReturnType<typeof beyondFrame>>,
    scale: number,
    seed: number,
  ): void {
    const g = this.graphics;
    const violet = 0xb0a0ff;
    if (frame.stage === 'contract' || frame.stage === 'quiet') {
      this.drawPixelRing(
        frame.reducedMotion ? 24 : frame.core,
        GOLD,
        frame.stage === 'quiet' ? 0.3 : 0.9,
        scale,
      );
    } else {
      this.drawPixelRing(
        frame.ring,
        frame.stage === 'open' ? BLUE : violet,
        0.8 * frame.alpha,
        scale,
      );
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6 + (seed % 100) / 100;
        const radius = frame.reducedMotion ? 155 : 22 + frame.expand * (130 + (i % 3) * 7);
        const p = orbit(angle, radius);
        g.fillStyle(i % 3 === 0 ? BLUE : violet, (1 - frame.expand) * 0.65 * frame.alpha);
        g.fillRect(
          Math.round(p.x * scale) / scale,
          Math.round(p.y * scale) / scale,
          2 / scale,
          2 / scale,
        );
      }
      if (frame.electron > 0)
        this.drawElectron(orbit(frame.angle, frame.ring), frame.electron * frame.alpha);
    }
  }
  private drawOrbit(
    radius: number,
    color: number,
    alpha: number,
    danger: boolean,
    scale: number,
  ): void {
    const g = this.graphics;
    g.lineStyle((danger ? 2 : 1) / scale, color, alpha);
    g.strokeCircle(180, 260, radius);
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
  private drawIntro(width: number, height: number): void {
    const g = this.graphics,
      clock = this.time.now / 1000;
    const frame = introFrame(clock, this.getLaunch(), this.reducedMotion.matches);
    const x = width / 2,
      y = height * 0.51;
    const size = Math.min(width * 0.44, height * 0.45, 184),
      radius = size * frame.radius,
      core = size * 0.42 * frame.core;
    g.setPosition(0, 0);
    g.setScale(1);
    g.lineStyle(1, 0x7295af, 0.4 * frame.alpha);
    g.strokeCircle(x, y, radius);
    g.fillStyle(0x0b1219, frame.alpha);
    g.fillCircle(x, y, core);
    g.lineStyle(1, 0xa7c4d9, 0.3 * frame.alpha);
    g.strokeCircle(x, y, core);
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2,
        next = ((i + 1) / 96) * Math.PI * 2;
      const light =
        (0.5 + 0.5 * Math.cos(a + 2.2 + (this.reducedMotion.matches ? 0 : clock * 0.07))) ** 5;
      for (const [stroke, alpha, ink] of [
        [3, 0.18, BLUE],
        [1, 1, WHITE],
      ]) {
        g.lineStyle(stroke, ink, alpha * light * frame.alpha);
        g.lineBetween(
          x + Math.cos(a) * core,
          y + Math.sin(a) * core,
          x + Math.cos(next) * core,
          y + Math.sin(next) * core,
        );
      }
    }
    const angle = frame.angle;
    for (let i = 36; i > 0; i--) {
      const a = angle - i * 0.022,
        next = angle - (i - 1) * 0.022;
      g.lineStyle(1, BLUE, (1 - i / 36) * 0.7 * frame.alpha);
      g.lineBetween(
        x + Math.cos(a) * radius,
        y + Math.sin(a) * radius,
        x + Math.cos(next) * radius,
        y + Math.sin(next) * radius,
      );
    }
    const electron = { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
    if (frame.pulse > 0.02) {
      const contact = { x: x + Math.cos(angle) * core, y: y + Math.sin(angle) * core };
      const pose = beamPose(electron, contact);
      if (pose.length >= 1)
        this.sprites
          .draw(
            pose,
            'beams',
            pose.length / 64,
            frame.pulse * frame.alpha * 0.75,
            1.5,
            beamFrame('basic', clock, 2),
            pose.angle,
          )
          .setTintMode(Phaser.TintModes.MULTIPLY)
          .setTint(BLUE);
      g.fillStyle(WHITE, frame.pulse * frame.alpha);
      g.fillRect(Math.round(contact.x) - 1, Math.round(contact.y) - 1, 2, 2);
    }
    this.sprites.draw(electron, 'electron', 1, frame.alpha, 2).clearTint();
  }
  private screen(point: Point): Point {
    return {
      x: this.width / 2 + (point.x - 180) * this.worldScale + this.offset.x,
      y: this.centerY + (point.y - 260) * this.worldScale + this.offset.y,
    };
  }
  private paint: EffectPainter = {
    sprite: (id, point, progress, color, alpha, size = 32) => {
      this.sprites
        .draw(this.screen(point), 'effects', size / 32, alpha, 1.5, effectFrame(id, progress))
        .setTintMode(Phaser.TintModes.MULTIPLY)
        .setTint(color);
    },
    beam: (id, from, to, progress, color, alpha, height, strength) => {
      const pose = beamPose(this.screen(from), this.screen(to));
      if (pose.length < 1) return;
      this.sprites
        .draw(
          pose,
          'beams',
          pose.length / 64,
          alpha,
          1,
          beamFrame(id, progress, strength),
          pose.angle,
          height / 16,
        )
        .setTintMode(Phaser.TintModes.MULTIPLY)
        .setTint(color);
    },
    contact: (point, color, alpha, radius) => {
      const screen = this.screen(point);
      const key = `${Math.round(screen.x)},${Math.round(screen.y)}`;
      const contact = this.contacts.get(key);
      if (!contact || alpha > contact.alpha)
        this.contacts.set(key, { point, color, alpha, radius });
    },
  };
  private drawElectron(point: Point, alpha: number, color = BLUE, surging = false): void {
    const sprite = this.sprites.draw(
      this.screen(point),
      surging ? 'electronSurge' : 'electron',
      1,
      alpha,
      2,
    );
    if (color !== BLUE && !surging) sprite.setTint(color);
    else sprite.clearTint();
  }
}
