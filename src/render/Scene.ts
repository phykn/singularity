import Phaser from 'phaser';
import beamsUrl from '../art/assets/beams.png';
import bossesUrl from '../art/assets/bosses.png';
import effectsUrl from '../art/assets/effects.png';
import particlesUrl from '../art/assets/particles.png';
import { AMBER, BLUE, GLUON, GOLD, RED, WHITE, skillColors } from '../art/palette.ts';
import { bossFrames, particleFrames } from '../art/particles.ts';
import { CENTER, clamp, orbit } from '../game/geometry.ts';
import { particleMotion } from '../game/particles.ts';
import type { Point } from '../game/geometry.ts';
import type { Game } from '../game/Game.ts';
import type { Target } from '../game/types.ts';
import type { Session } from '../session/Session.ts';
import { beamFrame, drawEffect, effectFrame, visibleEffects } from './effects.ts';
import type { Painter } from './effects.ts';
import { drawAccretion, drawCollapse, drawSingularity } from './ending.ts';
import { DamageLabels, SpritePool, createParticleTextures } from './sprites.ts';
import { drawRhythm } from './rhythm.ts';
import { arenaViewport, beyondFrame, endingFrame } from './timeline.ts';

// Phaser.TintModes.ADD: brightens without flattening, so crowded hits keep each shape and colour.
const addTint = 2;

export class Scene extends Phaser.Scene {
  private readonly session: Session;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private g!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private sprites!: SpritePool;
  private fxSprites!: SpritePool;
  private labels!: DamageLabels;
  private contacts = new Map<
    string,
    { point: Point; color: number; alpha: number; radius: number }
  >();
  private view = { width: 0, centerY: 0, scale: 1, x: 0, y: 0 };
  private shakeAt = -Infinity;
  private shake = 1;
  private model: Game | null = null;

  constructor(session: Session) {
    super('electron');
    this.session = session;
  }

  preload(): void {
    this.load.spritesheet('effects', effectsUrl, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('beams', beamsUrl, { frameWidth: 64, frameHeight: 16 });
    this.load.spritesheet('particles', particlesUrl, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('bosses', bossesUrl, { frameWidth: 64, frameHeight: 64 });
  }

  create(): void {
    this.g = this.add.graphics();
    this.fx = this.add.graphics().setDepth(1);
    createParticleTextures(this);
    this.sprites = new SpritePool(this.add);
    this.fxSprites = new SpritePool(this.add);
    this.labels = new DamageLabels(this);
  }

  update(): void {
    if (!this.g) return;
    this.sprites.begin();
    this.fxSprites.begin();
    this.contacts.clear();
    this.g.clear();
    this.fx.clear();
    this.frame(this.session.game);
    this.sprites.end();
    this.fxSprites.end();
  }

  private frame(game: Game): void {
    const width = this.scale.width,
      height = this.scale.height,
      { scale, centerY } = arenaViewport(width, height);
    if (this.model !== game) {
      this.model = game;
      this.shakeAt = -Infinity;
    }
    const ending = endingFrame(game),
      clock = game.seconds;
    this.watchImpact(game, !!ending);
    const age = clock - this.shakeAt,
      shaking = !ending && !this.reducedMotion.matches && age < 0.06 * this.shake;
    const dx = shaking ? (age % 0.06 < 0.03 ? 1 : -1) * this.shake : 0,
      dy = shaking ? this.shake : 0;
    this.view = {
      width,
      centerY,
      scale,
      x: width / 2 - CENTER.x * scale + dx,
      y: centerY - CENTER.y * scale + dy,
    };
    for (const layer of [this.g, this.fx])
      layer.setPosition(this.view.x, this.view.y).setScale(scale);
    if (game.phase !== 'running') this.labels.draw([], 0, width, height, centerY, scale);
    if (game.phase === 'ready') {
      this.drawOrbit(game.radius, BLUE, 0.32, false);
      this.drawTrail(game.angle, game.radius, 8, BLUE);
      this.drawElectron(game.position, 1);
      return;
    }
    const crossing = beyondFrame(game, this.reducedMotion.matches);
    if (crossing) return this.drawBeyond(crossing, game.seed);
    const danger = game.margin < game.rules.orbit.dangerMargin,
      color = game.finalProgress >= 1 ? GOLD : BLUE;
    if (!ending || (ending.success && ending.electron)) {
      const opacity = (danger ? 0.8 : 0.32) * (1 - (ending?.absorb ?? 0)),
        critical = game.critical && !ending;
      this.drawOrbit(
        ending?.electron ? ending.radius : game.radius,
        danger ? AMBER : critical ? RED : color,
        critical ? Math.max(opacity, 0.45 + 0.3 * Math.sin(clock * 8)) : opacity,
        danger,
      );
    }
    if (game.mass > 0 && (!ending || !ending.success || ending.electron))
      this.drawCore(game.core * (ending?.core ?? 1));
    if (ending && !ending.success) drawCollapse(this.g, ending, scale);
    if (!ending) this.drawArrivals(game);
    for (const target of game.targets) this.drawTarget(game, target, ending, clock);
    if (!ending) {
      const electron = game.position,
        satellites = game.combat.satellites,
        surging = game.combat.surging,
        anchors = { electron, satellites, orbit: game.radius };
      for (const point of satellites)
        this.sprites.draw(this.screen(point), 'electron', 0.5, 1).clearTint();
      for (const effect of visibleEffects(game.effects))
        drawEffect(this.fx, effect, clock, scale, this.paint, anchors);
      for (const { point, color: ink, alpha, radius } of this.contacts.values()) {
        this.fx.lineStyle(1 / scale, ink, alpha * 0.65);
        this.fx.strokeCircle(point.x, point.y, radius / scale);
      }
      this.drawTrail(
        game.angle,
        game.radius,
        surging ? 12 : 8,
        surging ? skillColors.surge : color,
      );
      this.drawElectron(electron, 1, color, surging);
      if (!this.session.paused)
        drawRhythm(
          this.fx,
          this.session.rhythm,
          game.radius,
          scale,
          electron,
          this.reducedMotion.matches,
          Math.hypot(width / (2 * scale), Math.max(centerY, height - centerY) / scale),
        );
      this.labels.draw(game.damageNumbers, clock, width, height, centerY, scale);
      return;
    }
    if (ending.electron) {
      const length = ending.success ? Math.round(16 - 10 * ending.absorb) : 34;
      this.drawTrail(ending.angle, ending.radius, length, ending.success ? GOLD : AMBER, true);
      this.drawElectron(ending.electron, 1);
    }
    if (ending.stage === 'silence') this.drawPoint(0.85);
    if (ending.hole) drawSingularity(this.g, ending.hole, scale, ending.glow);
    if (ending.success && game.phase === 'ending')
      drawAccretion(this.g, game.phaseTicks / game.rules.time.tickRate, scale);
    if (ending.success && ending.flash) {
      this.g.fillStyle(WHITE, ending.flash * 0.6);
      this.g.fillCircle(CENTER.x, CENTER.y, 5 / scale);
    }
  }

  // Thunderstrike shakes harder and longer than a Capacitor discharge.
  private watchImpact(game: Game, ending: boolean): void {
    if (ending || game.seconds - this.shakeAt <= 0.65) return;
    for (let i = game.effects.length - 1; i >= 0; i--) {
      const fx = game.effects[i];
      if (game.seconds - fx.born >= 0.05) break;
      if (fx.kind === 'strike' || (fx.source === 'charge' && fx.kind === 'bolt')) {
        this.shakeAt = game.seconds;
        this.shake = fx.kind === 'strike' ? 2 : 1;
        return;
      }
    }
  }

  private drawTarget(
    game: Game,
    target: Target,
    ending: ReturnType<typeof endingFrame>,
    clock: number,
  ): void {
    if (ending && !ending.success && ending.quiet) return;
    const absorb = ending?.absorb ?? 0,
      scale = this.view.scale;
    if (absorb >= 0.99) return;
    const p = ending?.success
      ? orbit(target.angle + absorb * absorb * Math.PI * 2, target.radius * (1 - absorb) ** 1.15)
      : target;
    if (ending?.hole && Math.hypot(p.x - CENTER.x, p.y - CENTER.y) <= ending.hole) return;
    const point = this.screen(p);
    if (
      point.x < -20 ||
      point.x > this.view.width + 20 ||
      point.y < -20 ||
      point.y > this.scale.height + 20
    )
      return;
    if (!ending) this.drawBehavior(game, target, clock);
    const look = this.look(game, target, clock),
      alpha = (1 - absorb) * look.alpha;
    const sprite = target.boss
      ? this.sprites.draw(point, 'bosses', 1, alpha, 0.5, bossFrames[target.boss], look.rotation)
      : this.sprites.draw(
          point,
          'particles',
          1,
          alpha,
          0.5,
          particleFrames[target.particle],
          look.rotation,
        );
    const hit = !ending && target.hitAt !== undefined && game.time - target.hitAt < 0.06;
    if (hit) sprite.setTint(0x5a5a5a).setTintMode(addTint);
    else sprite.clearTint();
    if (ending) return;
    if (target.marked) {
      this.g.fillStyle(skillColors.mark, 0.6 + 0.4 * Math.sin(clock * 14 + target.id));
      this.g.fillRect(
        p.x + target.size / 2,
        p.y - target.size / 2 - 2 / scale,
        2 / scale,
        2 / scale,
      );
    }
    if (target.kind === 'boss') {
      this.g.lineStyle((target.final ? 2 : 1) / scale, RED, 0.55 + 0.35 * Math.sin(clock * 6));
      this.g.strokeCircle(p.x, p.y, target.size + 4);
    } else if (target.hp > 0 && target.maxHp > game.damage + 1e-8) {
      // Health shows only on particles one basic hit cannot pop.
      const width = 12,
        filled = Math.max(1, Math.round(width * Math.min(1, target.hp / target.maxHp)));
      const left = (Math.round(point.x) - width / 2 - this.view.x) / scale,
        top = (Math.round(point.y) - 10 - this.view.y) / scale;
      if (filled < width) {
        this.g.fillStyle(0x492129, 1);
        this.g.fillRect(left, top, width / scale, 1 / scale);
      }
      this.g.fillStyle(filled < width ? 0xe4938c : 0xa7656b, 0.85);
      this.g.fillRect(left, top, filled / scale, 1 / scale);
    }
  }

  // How a particle's own rule shows: muons blink before a dash and face the core, mesons
  // spin, veiled neutrinos stay faint, a Z boson fades while immune, the tau points ahead.
  private look(game: Game, target: Target, clock: number) {
    const age = game.time - target.born,
      blink = Math.sin(clock * 30) > 0 ? 1 : 0.45;
    let alpha = target.veiled ? 0.3 : 1,
      rotation = 0;
    if (target.particle === 'muon' && target.kind !== 'boss') {
      rotation = target.angle;
      if (particleMotion(game.rules.particles.muon, age).charging)
        alpha = Math.sin(clock * 40) > 0 ? 1 : 0.35;
    } else if (target.particle === 'meson') rotation = age * 6;
    if (target.boss === 'tau') rotation = target.angle + Math.PI;
    const boss = game.bossPhase(target);
    if (boss?.immune) alpha = 0.3;
    else if (boss?.warning || boss?.charging) alpha = blink;
    return { alpha, rotation };
  }

  // A wave's red warning, then faint dots where formations are about to appear.
  private drawArrivals(game: Game): void {
    const g = this.g,
      pixel = 1 / this.view.scale,
      wave = game.warningWave;
    if (wave) {
      const elapsed = game.time - wave.time + game.rules.spawn.waveWarningSeconds,
        alpha = 0.3 + 0.65 * (0.5 + 0.5 * Math.cos(elapsed * Math.PI * 4));
      for (const side of [0, Math.PI]) {
        g.lineStyle(3 * pixel, RED, alpha).beginPath();
        for (let i = 0; i <= 16; i++) {
          const p = orbit(wave.angle + side - 0.24 + (i * 0.48) / 16, 172);
          if (i) g.lineTo(p.x, p.y);
          else g.moveTo(p.x, p.y);
        }
        g.strokePath();
        const mark = orbit(wave.angle + side, 156);
        g.fillStyle(RED, alpha);
        g.fillRect(mark.x - 2 * pixel, mark.y - 7 * pixel, 4 * pixel, 9 * pixel);
        g.fillRect(mark.x - 2 * pixel, mark.y + 5 * pixel, 4 * pixel, 3 * pixel);
      }
    }
    for (const spawn of game.pending) {
      const span = Math.max(1e-3, spawn.time - spawn.planned);
      g.fillStyle(WHITE, 0.12 + 0.18 * clamp((game.time - spawn.planned) / span));
      for (const m of spawn.members) {
        const p = orbit(m.angle, Math.min(m.radius, game.rules.orbit.spawnRadius + 6)),
          size = (m.kind === 'dense' ? 2 : 1.5) * pixel;
        g.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    }
  }

  // Tethers, the Higgs field and heavy rims, drawn under the sprite.
  private drawBehavior(game: Game, target: Target, clock: number): void {
    const g = this.g,
      pixel = 1 / this.view.scale;
    if (target.tether !== undefined) {
      const holder = game.targets.find((t) => t.id === target.tether);
      if (holder) {
        g.lineStyle(pixel, GLUON, 0.35 + 0.2 * Math.sin(clock * 9 + target.id));
        g.lineBetween(holder.x, holder.y, target.x, target.y);
      }
    }
    if (target.boss === 'higgs') {
      const field = game.higgsField(target);
      g.lineStyle(pixel, GOLD, 0.25 + 0.1 * Math.sin(clock * 3)).strokeCircle(
        target.x,
        target.y,
        field,
      );
      g.fillStyle(GOLD, 0.05).fillCircle(target.x, target.y, field);
    }
    if (target.higgs)
      g.lineStyle(pixel, GOLD, 0.5).strokeCircle(target.x, target.y, target.size + 1);
    if (target.particle === 'neutron' && target.kind !== 'boss') {
      // Heavy particles light their rim as they near the core.
      const near = clamp(1 - (target.radius - game.core) / 60);
      if (near > 0)
        g.lineStyle(pixel, RED, 0.6 * near).strokeCircle(target.x, target.y, target.size);
    }
  }

  private drawBeyond(frame: NonNullable<ReturnType<typeof beyondFrame>>, seed: number): void {
    const g = this.g,
      scale = this.view.scale;
    if (frame.stage === 'depart' || frame.stage === 'contract' || frame.stage === 'quiet') {
      if (frame.core > 0) drawSingularity(g, frame.core, scale, 0, frame.core / 24);
    } else {
      if (frame.ring > 0 && frame.alpha > 0)
        this.drawOrbit(frame.ring, frame.color, frame.opacity * frame.alpha, false);
      for (let i = 0; i < 6 && frame.dust > 0; i++) {
        const p = orbit(
          (i * Math.PI) / 3 + (seed % 100) / 100,
          frame.ring * (1.04 + (i % 3) * 0.04),
        );
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
          this.drawTrail(frame.angle, frame.ring, 8, BLUE, false, frame.trail * frame.alpha);
        this.drawElectron(orbit(frame.angle, frame.ring), frame.electron * frame.alpha);
      }
    }
    if (frame.point > 0) this.drawPoint(frame.point * 0.85);
  }

  // The one bright pixel left at the center.
  private drawPoint(alpha: number): void {
    const s = 1.5 / this.view.scale;
    this.g.fillStyle(WHITE, alpha);
    this.g.fillRect(CENTER.x - s, CENTER.y - s, 2 * s, 2 * s);
  }

  private drawOrbit(radius: number, color: number, alpha: number, danger: boolean): void {
    this.g.lineStyle((danger ? 2 : 1) / this.view.scale, color, alpha);
    this.g.strokeCircle(CENTER.x, CENTER.y, radius);
  }

  private drawTrail(
    angle: number,
    radius: number,
    length: number,
    color: number,
    spiral = false,
    alpha = 1,
  ): void {
    for (let i = length; i > 0; i--) {
      const r = radius + (spiral ? i * 0.65 : 0),
        p = orbit(angle - i * 0.035, r),
        q = orbit(angle - (i - 1) * 0.035, r);
      this.g.lineStyle(
        (1 + 2 * (1 - i / length)) / this.view.scale,
        color,
        0.65 * (1 - i / length) * alpha,
      );
      this.g.lineBetween(p.x, p.y, q.x, q.y);
    }
  }

  // A faceted rock that grows with the core mass, snapped to two-pixel steps.
  private drawCore(radius: number): void {
    const g = this.g,
      pixel = 2 / this.view.scale;
    const point = ([x, y]: number[]) =>
      new Phaser.Math.Vector2(
        CENTER.x + Math.round((x * radius) / pixel) * pixel,
        CENTER.y + Math.round((y * radius) / pixel) * pixel,
      );
    const h = [
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
    const facets: [number, number[][]][] = [
      [0x344d60, [h[0], h[1], h[2], h[3], [0.18, -0.2], [-0.3, 0.06], h[10]]],
      [0x47687a, [h[1], h[2], h[3], [-0.08, -0.49], [-0.3, -0.12], h[0]]],
      [0x182a37, [[0.18, -0.2], h[3], h[4], h[5], [0.46, 0.2], [0.07, 0.31]]],
      [0x385464, [h[5], h[6], h[7], [0.11, 0.62], [0.07, 0.31], [0.46, 0.2]]],
      [0x142431, [h[7], h[8], h[9], h[10], [-0.35, 0.24], [0.11, 0.62]]],
      [
        0x526f80,
        [
          [-0.35, 0.24],
          [-0.3, 0.06],
          [0.18, -0.2],
          [0.07, 0.31],
          [-0.12, 0.47],
        ],
      ],
    ];
    g.fillStyle(0x263e4c, 1);
    g.fillPoints(h.map(point), true);
    for (const [ink, points] of facets) {
      g.fillStyle(ink, 1);
      g.fillPoints(points.map(point), true);
    }
    g.lineStyle(pixel, 0x91b6c6, 0.75);
    g.strokePoints([h[0], h[1], h[2]].map(point), false);
    g.lineStyle(pixel, 0x62889b, 0.6);
    g.strokePoints([h[5], h[6], h[7]].map(point), false);
  }

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

  private screen(point: Point): Point {
    const v = this.view;
    return { x: v.x + point.x * v.scale, y: v.y + point.y * v.scale };
  }

  private paint: Painter = {
    sprite: (id, point, progress, color, alpha, size) => {
      this.fxSprites
        .draw(this.screen(point), 'effects', size / 32, alpha, 1.5, effectFrame(id, progress))
        .setTint(color);
    },
    beam: (id, from, to, progress, color, alpha, height, strength) => {
      const a = this.screen(from),
        b = this.screen(to),
        length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        angle = Math.atan2(b.y - a.y, b.x - a.x);
      const beam = this.fxSprites.draw(
        mid,
        'beams',
        length / 64,
        alpha,
        1,
        beamFrame(id, progress, strength),
        angle,
        height / 16,
      );
      if (id === 'strike') beam.clearTint();
      else beam.setTint(color);
    },
    particle: (kind, point, boss) => {
      const at = this.screen(point);
      (boss
        ? this.fxSprites.draw(at, 'bosses', 1, 1, 0.5, bossFrames[boss])
        : this.fxSprites.draw(at, 'particles', 1, 1, 0.5, particleFrames[kind])
      )
        .setTint(0x5a5a5a)
        .setTintMode(addTint);
    },
    contact: (point, color, alpha, radius) => {
      const at = this.screen(point),
        key = `${Math.round(at.x)},${Math.round(at.y)}`,
        old = this.contacts.get(key);
      if (!old || alpha > old.alpha) this.contacts.set(key, { point, color, alpha, radius });
    },
  };
}
