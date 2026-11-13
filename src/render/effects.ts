import type Phaser from 'phaser';
import { AMBER, BLUE, WHITE, skillColors } from '../art/palette.ts';
import { particleColors } from '../art/particles.ts';
import { CENTER, clamp, orbit } from '../game/geometry.ts';
import type { Point } from '../game/geometry.ts';
import { rarityIds } from '../game/rules.ts';
import type { BossKind, ParticleKind } from '../game/rules.ts';
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
type Anchors = { electron: Point; satellites: readonly Point[]; orbit: number };

// Frames in the beam atlas: ten strengths of eight beams, four frames each.
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
  const counts: Record<string, number> = {},
    shown: Effect[] = [];
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
// A circle snapped to screen pixels.
function ring(
  g: Graphics,
  center: Point,
  radius: number,
  ink: number,
  alpha: number,
  scale: number,
  width = 2,
) {
  if (radius <= 0) return;
  const snap = (v: number) => Math.round(v * scale) / scale,
    points = Array.from({ length: 41 }, (_, i) => ({
      x: snap(center.x + Math.cos((i * Math.PI) / 20) * radius),
      y: snap(center.y + Math.sin((i * Math.PI) / 20) * radius),
    }));
  stroke(g, points, width, ink, alpha, scale);
}
// Square shards around a point, every third one white.
function shards(
  g: Graphics,
  center: Point,
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
      center.x + Math.cos(angle) * reach(i) - pixel / 2,
      center.y + Math.sin(angle) * reach(i) - pixel / 2,
      pixel,
      pixel,
    );
  }
}
function dot(g: Graphics, x: number, y: number, ink: number, alpha: number, scale: number) {
  g.fillStyle(ink, alpha);
  g.fillRect(x - 1 / scale, y - 1 / scale, 2 / scale, 2 / scale);
}

// One effect's frame: where its ends are now, how far through its life it is and how it looks.
type Frame = {
  g: Graphics;
  fx: Effect;
  paint: Painter;
  a: Anchors;
  time: number;
  scale: number;
  from: Point;
  to: Point;
  t: number;
  alpha: number;
  ink: number;
  // Beam strength from damage, and the brightness and impact size that go with it.
  power: number;
  light: number;
  impact: number;
  clock: number;
};

function drawBolt({
  g,
  fx,
  paint,
  scale,
  from,
  to,
  t,
  alpha,
  ink,
  power,
  light,
  impact,
  clock,
}: Frame) {
  const strike = fx.kind === 'strike',
    id: BeamId = strike
      ? 'strike'
      : fx.source === 'charge' || fx.source === 'spark'
        ? fx.source
        : ['chain', 'burst', 'fission'].includes(fx.source ?? '')
          ? 'chain'
          : 'basic';
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
  if (!strike)
    return paint.sprite(fx.source === 'charge' ? 'impact' : 'hit', to, t, ink, alpha, impact);
  // Thunderstrike lands hard: a wider bolt, a flash and shards across its splash.
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

// Overclock's current along the orbit behind the electron.
function drawTrail({ g, fx, paint, a, scale, ink, power, light, clock }: Frame) {
  const arc = fx.arc;
  if (!arc || arc.sweep <= 0) return;
  const steps = Math.max(1, Math.ceil(arc.sweep / 0.15)),
    angle = (i: number) => arc.start + (arc.sweep * i) / steps;
  for (let i = 0; i < steps; i++)
    paint.beam(
      'trail',
      orbit(angle(i), a.orbit),
      orbit(angle(i + 1), a.orbit),
      clock + i * 0.07,
      ink,
      light,
      16,
      power,
    );
  for (const edge of [angle(0), angle(steps)])
    stroke(
      g,
      [orbit(edge, a.orbit - 2 / scale), orbit(edge, a.orbit + 2 / scale)],
      1,
      WHITE,
      0.85,
      scale,
    );
}

// A delayed pop holds its particle bright until its turn, then dissolves it into shards.
function drawKill({ g, fx, paint, time, scale, from }: Frame) {
  const delay = fx.delay ?? 0,
    local = (time - fx.born - delay) / (fx.life - delay);
  if (local < 0) {
    if (fx.particle) paint.particle(fx.particle, from, fx.boss);
    return;
  }
  const color = fx.particle ? particleColors[fx.particle] : BLUE,
    big = fx.radius > 30,
    travel = fx.radius * 0.5 + (8 + fx.radius * 0.8) * (1 - (1 - local) ** 2);
  paint.sprite('dissolve', from, local, color, (1 - local) ** 2, Math.max(32, fx.radius * 2));
  // Shards fly out so every pop reads even inside a crowd.
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
}

const draw: Record<Effect['kind'], (frame: Frame) => void> = {
  bolt: drawBolt,
  strike: drawBolt,
  trail: drawTrail,
  kill: drawKill,
  pierce: ({ paint, from, to, alpha, ink, power, light, clock }) =>
    paint.beam('pierce', from, to, clock, ink, light * alpha, 16, power),
  // The field ring opens to its reach and fades there.
  field: ({ g, fx, scale, from, t, alpha, ink }) => {
    const wave = lerp(fx.radius * 0.4, fx.radius, clamp(t / 0.85)),
      rank = Math.max(1, Math.min(5, fx.rank));
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
  },
  // The Capacitor's glow; its width carries how full it is.
  charge: ({ fx, paint, from, alpha, ink }) =>
    paint.contact(from, ink, alpha * clamp(fx.width) * 0.3, 10),
  surge: ({ paint, from, t, ink }) => {
    if (t < 0.15) paint.contact(from, ink, (1 - t / 0.15) * 0.7, 9.6);
  },
  return: ({ g, paint, scale, from, to, t, alpha, ink, power, light, clock }) => {
    const travel = clamp(t / 0.7);
    paint.beam('return', from, to, clock, ink, alpha * light, 16, power);
    dot(g, lerp(from.x, to.x, travel), lerp(from.y, to.y, travel), WHITE, alpha, scale);
    if (t >= 0.65) paint.contact(to, ink, (1 - t) / 0.35, (22 + Math.min(power, 3) * 2) / 2.5);
  },
  upgrade: ({ g, fx, scale, from, t, alpha, ink }) => {
    const strength = clamp(fx.rank / 5) + rarityIds.indexOf(fx.rarity) * 0.06;
    if (fx.source === 'range') ring(g, from, fx.radius, ink, alpha * 0.22, scale, 1);
    else if (fx.source === 'recover')
      ring(g, from, fx.radius * (1 + t * 0.6), ink, alpha * 0.65, scale, 1);
    else ring(g, from, (9 + t * (16 + strength * 8)) / scale, ink, alpha * 0.65, scale, 1);
  },
  // A missed particle falls into the core.
  absorb: ({ g, scale, from, t, alpha }) => {
    const q = Math.min(1, t * 2);
    dot(g, lerp(from.x, CENTER.x, q), lerp(from.y, CENTER.y, q), AMBER, alpha, scale);
  },
  convert: ({ g, fx, scale, from, t, alpha }) =>
    ring(g, from, fx.radius * (0.3 + 0.7 * t), particleColors.muon, alpha * 0.7, scale, 1),
  level: ({ g, fx, scale, from, t, alpha, ink }) =>
    ring(g, from, fx.radius * (0.25 + 0.75 * t), ink, alpha * 0.6, scale, 1),
};

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
  const anchored = (anchor: Effect['anchor'], fallback: Point) =>
      typeof anchor === 'number'
        ? (a.satellites[anchor] ?? fallback)
        : anchor === 'electron'
          ? a.electron
          : fallback,
    from = anchored(fx.anchor, fx.from),
    // A pierce line keeps its direction from wherever its start is now.
    to =
      fx.endAnchor !== undefined
        ? anchored(fx.endAnchor, fx.to)
        : fx.kind === 'pierce'
          ? { x: from.x + fx.to.x - fx.from.x, y: from.y + fx.to.y - fx.from.y }
          : fx.to,
    power = Math.max(1, Math.min(10, Math.ceil(fx.damage / 10)));
  draw[fx.kind]({
    g,
    fx,
    paint,
    a,
    time,
    scale,
    from,
    to,
    t,
    alpha: Math.pow(1 - t, 0.7),
    ink: fx.source ? skillColors[fx.source] : fx.kind === 'trail' ? skillColors.overclock : BLUE,
    power,
    light: 0.7 + 0.22 * (fx.damage / (fx.damage + 10)),
    impact: 20 + Math.min(power, 3) * 4,
    clock: time + fx.born * 3 + (fx.kind === 'strike' ? ((fx.targetId ?? 0) % 4) / 12 : 0),
  });
}
