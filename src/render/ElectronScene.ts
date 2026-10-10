import Phaser from 'phaser';
import { createParticleTextures } from './particleTextures.ts';
import { SpritePool } from './SpritePool.ts';
import { healthBar } from './healthBars.ts';
import { endingFrame } from './ending.ts';
import { drawSingularity, drawAccretion } from './singularity.ts';
import { drawCollapse } from './collapse.ts';
import { beyondFrame } from './beyond.ts';
import { beamFrame, beamPose, effectFrame, visibleEffects } from './effects.ts';
import type { EffectPainter } from './effects.ts';
import effectsUrl from '../art/assets/effects.png';
import beamsUrl from '../art/assets/beams.png';
import { DamageLabels } from './DamageLabels.ts';
import { orbit, clamp } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import type { Game } from '../game/Game.ts';
import { BLUE, WHITE, AMBER, GOLD, VIOLET, skillColors } from '../art/palette.ts';
import { drawEffect } from './drawEffects.ts';
import { drawWaveWarning } from './warning.ts';
import { drawElectronField } from './electronField.ts';
import type { OrbitRhythm } from '../app/OrbitRhythm.ts';
import { drawRhythm } from './rhythm.ts';
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
  private offset = { x: 0, y: 0 };
  private width = 0;
  private centerY = 0;
  private worldScale = 1;
  private damageLabels!: DamageLabels;
  private getGame: () => Game;
  private getRhythm: () => OrbitRhythm;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  constructor(getGame: () => Game, getRhythm: () => OrbitRhythm) {
    super('electron');
    this.getGame = getGame;
    this.getRhythm = getRhythm;
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
    }
    g.setPosition(width / 2 - 180 * scale, this.centerY - 260 * scale);
    g.setScale(scale);
    this.effectGraphics.setPosition(g.x, g.y).setScale(scale).setDepth(1);
    if (game.phase === 'ready') {
      this.offset = { x: 0, y: 0 };
      this.drawOrbit(game.radius, BLUE, 0.32, false, scale);
      this.drawTrail(game.angle, game.radius, 8, BLUE, scale);
      this.drawElectron(game.position, 1, BLUE);
      this.cover(width, height, 1 - clamp((this.time.now - this.returnAt) / 550));
      return;
    }
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
    const orbitColor = game.endless ? VIOLET : color;
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
    if (!ending || (ending.success && ending.electron)) {
      const opacity = (danger ? 0.8 : 0.32) * (1 - (ending?.absorb ?? 0));
      this.drawOrbit(radius, danger ? AMBER : orbitColor, opacity, danger, scale);
    }
    if (game.mass > 0 && (!ending || !ending.success || ending.electron))
      this.drawCore(game.core * (ending?.core ?? 1), scale);
    if (ending && !ending.success) drawCollapse(g, ending, scale);
    const warning = game.warningWave;
    if (warning)
      drawWaveWarning(
        g,
        warning.angle,
        game.time - warning.time + game.rules.waveWarningSeconds,
        scale,
      );
    for (const target of game.targets) {
      if (ending && !ending.success && ending.quiet) continue;
      const absorb = ending?.absorb ?? 0;
      if (absorb >= 0.99) continue;
      const p = ending?.success
        ? orbit(target.angle + absorb * absorb * Math.PI * 2, target.radius * (1 - absorb) ** 1.15)
        : target;
      if (ending?.hole && Math.hypot(p.x - 180, p.y - 260) <= ending.hole) continue;
      const point = this.screen(p);
      if (point.x < -20 || point.x > width + 20 || point.y < -20 || point.y > height + 20) continue;
      const hit = !ending && target.hitAt !== undefined && game.time - target.hitAt < 0.06;
      const sprite = this.sprites.draw(point, target.particle, 1, 1 - absorb);
      if (ending?.success && absorb > 0 && target.id % 9 === 0) {
        const tail = orbit(
          target.angle + absorb * absorb * Math.PI * 2 - 0.08,
          target.radius * (1 - absorb) ** 1.15 + 4 * absorb,
        );
        g.lineStyle(1 / scale, WHITE, Math.sin(absorb * Math.PI) * 0.25);
        g.lineBetween(tail.x, tail.y, p.x, p.y);
      }
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
      if (!game.paused && !game.charged)
        drawRhythm(
          this.effectGraphics,
          this.getRhythm(),
          game.radius,
          scale,
          position,
          this.reducedMotion.matches,
          Math.hypot(width / (2 * scale), Math.max(this.centerY, height - this.centerY) / scale),
        );
      this.damageLabels.draw(game, width, height, this.centerY, scale);
      return;
    }
    if (ending.electron) {
      this.drawTrail(
        ending.angle,
        ending.radius,
        ending.success ? Math.round(16 - 10 * ending.absorb) : 34,
        ending.success ? GOLD : AMBER,
        scale,
        true,
      );
      this.drawElectron(ending.electron, 1, BLUE);
    }
    if (ending.stage === 'silence') {
      g.fillStyle(WHITE, 0.85);
      g.fillRect(180 - 1.5 / scale, 260 - 1.5 / scale, 3 / scale, 3 / scale);
    }
    if (ending.hole) this.drawSingularity(ending.hole, scale, ending.glow);
    if (ending.success && game.phase === 'ending')
      drawAccretion(g, game.phaseTicks / game.rules.tickRate, scale);
    if (ending.success && ending.flash) {
      g.fillStyle(WHITE, ending.flash * 0.6);
      g.fillCircle(180, 260, 5 / scale);
    }
  }
  private drawBeyond(
    frame: NonNullable<ReturnType<typeof beyondFrame>>,
    scale: number,
    seed: number,
  ): void {
    const g = this.graphics;
    if (frame.stage === 'depart' || frame.stage === 'contract' || frame.stage === 'quiet') {
      if (frame.core > 0) {
        drawSingularity(g, frame.core, scale, 0, frame.core / 24);
      }
    } else {
      if (frame.ring > 0 && frame.alpha > 0)
        this.drawOrbit(frame.ring, frame.color, frame.opacity * frame.alpha, false, scale);
      for (let i = 0; i < 6 && frame.dust > 0; i++) {
        const angle = (i * Math.PI) / 3 + (seed % 100) / 100;
        const radius = frame.ring * (1.04 + (i % 3) * 0.04);
        const p = orbit(angle, radius);
        g.fillStyle(frame.color, frame.dust * frame.alpha);
        g.fillRect(
          Math.round(p.x * scale) / scale,
          Math.round(p.y * scale) / scale,
          2 / scale,
          2 / scale,
        );
      }
      if (frame.electron > 0) {
        if (frame.trail > 0)
          this.drawTrail(frame.angle, frame.ring, 8, BLUE, scale, false, frame.trail * frame.alpha);
        this.drawElectron(orbit(frame.angle, frame.ring), frame.electron * frame.alpha);
      }
    }
    if (frame.point > 0) {
      g.fillStyle(WHITE, frame.point * 0.85);
      g.fillRect(180 - 1.5 / scale, 260 - 1.5 / scale, 3 / scale, 3 / scale);
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
    alpha = 1,
  ): void {
    const g = this.graphics;
    for (let i = length; i > 0; i--) {
      const r = radius + (spiral ? i * 0.65 : 0);
      const p = orbit(angle - i * 0.035, r),
        q = orbit(angle - (i - 1) * 0.035, r);
      g.lineStyle((1 + 2 * (1 - i / length)) / scale, color, 0.65 * (1 - i / length) * alpha);
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
  private drawSingularity(radius: number, scale: number, glow: number): void {
    drawSingularity(this.graphics, radius, scale, glow);
  }
  private cover(width: number, height: number, alpha: number): void {
    if (alpha <= 0) return;
    this.effectGraphics.setPosition(0, 0).setScale(1).setDepth(3);
    this.effectGraphics.fillStyle(0x020306, alpha);
    this.effectGraphics.fillRect(0, 0, width, height);
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
      const beam = this.sprites.draw(
        pose,
        'beams',
        pose.length / 64,
        alpha,
        1,
        beamFrame(id, progress, strength),
        pose.angle,
        height / 16,
      );
      if (id === 'strike') beam.clearTint();
      else beam.setTintMode(Phaser.TintModes.MULTIPLY).setTint(color);
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
