import type Phaser from 'phaser';
import { AMBER, BLUE, WHITE, skillColors } from '../art/palette.ts';
import { particleColors } from '../art/particles.ts';
import { CENTER, clamp, orbit } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import type { BossKind } from '../game/bosses.ts';
import type { ParticleKind } from '../game/particles.ts';
import { rarityIds } from '../game/rules.ts';
import type { Effect } from '../game/types.ts';

type Graphics = Phaser.GameObjects.Graphics;
const effectRows = { hit: 0, impact: 1, dissolve: 2 } as const;
const beamRows = {
  basic: 0,
  chain: 1,
  pierce: 2,
  strike: 3,
  spark: 4,
  charge: 5,
  trail: 6,
  return: 7,
};
type BeamId = keyof typeof beamRows;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Points are world coordinates; sprite sizes, beam heights and contact radii are screen pixels.
export type Painter = {
  sprite(
    id: keyof typeof effectRows,
    point: Point,
    progress: number,
    color: number,
    alpha: number,
    size: number,
  ): void;
  beam(
    id: BeamId,
    from: Point,
    to: Point,
    progress: number,
    color: number,
    alpha: number,
    height: number,
    strength: number,
  ): void;
  contact(point: Point, color: number, alpha: number, radius: number): void;
  // A brightened particle held in place until its delayed pop.
  particle(kind: ParticleKind, point: Point, boss?: BossKind): void;
};

export const beamStrength = (damage: number) => Math.max(1, Math.min(10, Math.ceil(damage / 10)));
export const beamFrame = (id: BeamId, progress: number, strength = 1) =>
  Math.max(0, Math.min(9, Math.floor(strength) - 1)) * 32 +
  beamRows[id] * 4 +
  (Math.floor(Math.max(0, progress) * 12) % 4);
export const effectFrame = (id: keyof typeof effectRows, progress: number) =>
  effectRows[id] * 4 + Math.min(3, Math.floor(Math.max(0, progress) * 4));

// How many of each kind stay on screen, newest first; bolts count by the skill that threw them.
const boltSources = ['chain', 'burst', 'fission', 'spark'];
const limits: Record<string, number> = {
  primary: 12,
  chain: 18,
  pierce: 3,
  burst: 6,
  strike: 8,
  trail: 5,
  charge: 1,
  field: 8,
  surge: 1,
  return: 10,
  fission: 12,
  spark: 12,
  kill: 32,
  level: 2,
  upgrade: 1,
  absorb: 4,
  convert: 4,
};
export function visibleEffects(effects: readonly Effect[]): Effect[] {
  const counts: Record<string, number> = {};
  const shown: Effect[] = [];
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i],
      key =
        fx.kind !== 'bolt'
          ? fx.kind
          : boltSources.includes(fx.source ?? '')
            ? fx.source!
            : 'primary';
    counts[key] = (counts[key] ?? 0) + 1;
    if (counts[key] <= limits[key]) shown.push(fx);
  }
  return shown.reverse();
}

function stroke(
  g: Graphics,
  points: Point[],
  width: number,
  ink: number,
  alpha: number,
  scale: number,
) {
  g.lineStyle(Math.max(1, Math.round(width)) / scale, ink, alpha);
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) g.lineTo(p.x, p.y);
  g.strokePath();
}
function ring(
  g: Graphics,
  at: Point,
  radius: number,
  ink: number,
  alpha: number,
  scale: number,
  width = 2,
) {
  if (radius <= 0) return;
  const snap = (v: number) => Math.round(v * scale) / scale;
  const points = Array.from({ length: 41 }, (_, i) => ({
    x: snap(at.x + Math.cos((i * Math.PI) / 20) * radius),
    y: snap(at.y + Math.sin((i * Math.PI) / 20) * radius),
  }));
  stroke(g, points, width, ink, alpha, scale);
}
function shards(
  g: Graphics,
  at: Point,
  count: number,
  reach: (i: number) => number,
  turn: number,
  ink: number,
  alpha: number,
  pixel: number,
) {
  for (let i = 0; i < count; i++) {
    const angle = (i * Math.PI * 2) / count + turn;
    g.fillStyle(i % 3 ? ink : WHITE, alpha);
    g.fillRect(
      at.x + Math.cos(angle) * reach(i) - pixel / 2,
      at.y + Math.sin(angle) * reach(i) - pixel / 2,
      pixel,
      pixel,
    );
  }
}

export type Anchors = { electron: Point; satellites: readonly Point[]; orbit: number };
const anchored = (anchor: Effect['anchor'], fallback: Point, a: Anchors) =>
  typeof anchor === 'number'
    ? (a.satellites[anchor] ?? fallback)
    : anchor === 'electron'
      ? a.electron
      : fallback;

export function drawEffect(
  g: Graphics,
  fx: Effect,
  time: number,
  scale: number,
  paint: Painter,
  a: Anchors,
): void {
  const t = clamp((time - fx.born) / fx.life);
  if (t >= 1) return;
  const from = anchored(fx.anchor, fx.from, a);
  const to =
    fx.endAnchor !== undefined
      ? anchored(fx.endAnchor, fx.to, a)
      : fx.kind === 'pierce'
        ? { x: from.x + fx.to.x - fx.from.x, y: from.y + fx.to.y - fx.from.y }
        : fx.to;
  const alpha = Math.pow(1 - t, 0.7),
    ink = fx.source ? skillColors[fx.source] : fx.kind === 'trail' ? skillColors.overclock : BLUE;
  const rank = Math.max(1, Math.min(5, fx.rank)),
    power = beamStrength(fx.damage),
    light = 0.7 + 0.22 * (fx.damage / (fx.damage + 10)),
    impact = 20 + Math.min(power, 3) * 4;
  const clock = time + fx.born * 3 + (fx.kind === 'strike' ? ((fx.targetId ?? 0) % 4) / 12 : 0);
  if (fx.kind === 'trail') {
    if (!fx.arc || fx.arc.sweep <= 0) return;
    const steps = Math.max(1, Math.ceil(fx.arc.sweep / 0.15)),
      at = (i: number) => fx.arc!.start + (fx.arc!.sweep * i) / steps;
    for (let i = 0; i < steps; i++)
      paint.beam(
        'trail',
        orbit(at(i), a.orbit),
        orbit(at(i + 1), a.orbit),
        clock + i * 0.07,
        ink,
        light,
        16,
        power,
      );
    for (const edge of [at(0), at(steps)])
      stroke(
        g,
        [orbit(edge, a.orbit - 2 / scale), orbit(edge, a.orbit + 2 / scale)],
        1,
        WHITE,
        0.85,
        scale,
      );
  } else if (fx.kind === 'field') {
    // The field ring opens to its reach and fades there.
    const wave = lerp(fx.radius * 0.4, fx.radius, clamp(t / 0.85));
    ring(g, from, wave, ink, alpha * 0.7, scale, 1);
    shards(
      g,
      from,
      6,
      (i) => wave * (i % 2 ? 0.9 : 1),
      fx.born,
      ink,
      alpha * 0.85,
      (1 + Math.ceil(rank / 2)) / scale,
    );
  } else if (fx.kind === 'charge') paint.contact(from, ink, alpha * clamp(fx.width) * 0.3, 10);
  else if (fx.kind === 'surge') {
    if (t < 0.15) paint.contact(from, ink, (1 - t / 0.15) * 0.7, 9.6);
  } else if (fx.kind === 'return') {
    paint.beam('return', from, to, clock, ink, alpha * light, 16, power);
    const travel = clamp(t / 0.7);
    g.fillStyle(WHITE, alpha);
    g.fillRect(
      lerp(from.x, to.x, travel) - 1 / scale,
      lerp(from.y, to.y, travel) - 1 / scale,
      2 / scale,
      2 / scale,
    );
    if (t >= 0.65) paint.contact(to, ink, (1 - t) / 0.35, (22 + Math.min(power, 3) * 2) / 2.5);
  } else if (fx.kind === 'bolt' || fx.kind === 'strike') {
    const strike = fx.kind === 'strike',
      id: BeamId = strike
        ? 'strike'
        : fx.source === 'charge' || fx.source === 'spark'
          ? fx.source
          : ['chain', 'burst', 'fission'].includes(fx.source ?? '')
            ? 'chain'
            : 'basic';
    // Thunderstrike lands hard: a wider bolt, a flash and shards across its splash.
    paint.beam(
      id,
      from,
      to,
      clock,
      ink,
      light * (strike ? Math.min(1, alpha * 1.6) : alpha),
      strike ? 24 : 16,
      power,
    );
    if (fx.source === 'charge') paint.contact(from, ink, alpha, 9.6);
    if (!strike) paint.sprite(fx.source === 'charge' ? 'impact' : 'hit', to, t, ink, alpha, impact);
    else {
      paint.sprite('impact', to, t, ink, alpha, impact * 1.6);
      if (t < 0.25) paint.contact(to, WHITE, (1 - t / 0.25) * 0.9, 12);
      ring(g, to, fx.radius * (0.3 + 0.7 * clamp(t / 0.6)), ink, alpha * 0.8, scale, 2);
      const reach = fx.radius * (0.4 + 0.8 * clamp(t / 0.7));
      shards(
        g,
        to,
        8,
        (i) => reach * (i % 2 ? 0.8 : 1),
        (fx.targetId ?? 0) * 0.7,
        ink,
        alpha,
        2 / scale,
      );
    }
  } else if (fx.kind === 'pierce')
    paint.beam('pierce', from, to, clock, ink, light * alpha, 16, power);
  else if (fx.kind === 'upgrade') {
    const strength = clamp(fx.rank / 5) + rarityIds.indexOf(fx.rarity) * 0.06;
    if (fx.source === 'range') ring(g, from, fx.radius, ink, alpha * 0.22, scale, 1);
    else if (fx.source === 'recover')
      ring(g, from, fx.radius * (1 + t * 0.6), ink, alpha * 0.65, scale, 1);
    else ring(g, from, (9 + t * (16 + strength * 8)) / scale, ink, alpha * 0.65, scale, 1);
  } else if (fx.kind === 'absorb') {
    g.fillStyle(AMBER, alpha);
    const q = Math.min(1, t * 2);
    g.fillRect(
      lerp(from.x, CENTER.x, q) - 1 / scale,
      lerp(from.y, CENTER.y, q) - 1 / scale,
      2 / scale,
      2 / scale,
    );
  } else if (fx.kind === 'kill') {
    const delay = fx.delay ?? 0,
      local = (time - fx.born - delay) / (fx.life - delay);
    if (local < 0) {
      if (fx.particle) paint.particle(fx.particle, from, fx.boss);
      return;
    }
    const color = fx.particle ? particleColors[fx.particle] : BLUE;
    paint.sprite('dissolve', from, local, color, (1 - local) ** 2, Math.max(32, fx.radius * 2));
    // Shards fly out so every pop reads even inside a crowd.
    const big = fx.radius > 30,
      travel = fx.radius * 0.5 + (8 + fx.radius * 0.8) * (1 - (1 - local) ** 2);
    shards(
      g,
      from,
      big ? 14 : fx.radius > 8 ? 8 : 6,
      (i) => travel * (i % 3 ? 1 : 0.7),
      fx.born * 7,
      color,
      1 - local,
      (big ? 3 : 2) / scale,
    );
  } else if (fx.kind === 'convert')
    ring(g, from, fx.radius * (0.3 + 0.7 * t), particleColors.muon, alpha * 0.7, scale, 1);
  else ring(g, from, fx.radius * (0.25 + 0.75 * t), ink, alpha * 0.6, scale, 1);
}
