import type { ParticleKind } from '../game/rules.ts';
import type { BossKind } from '../game/rules.ts';

// The electron is drawn in code. Digits index the palette: 1 rim, 2 shade, 3 body, 4 highlight.
type Cell = (dx: number, dy: number) => string;

function draw(cell: Cell): string[] {
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => cell(x - 7.5, y - 7.5)).join(''),
  );
}

function ball(dx: number, dy: number, radius: number): string {
  const distance = Math.hypot(dx, dy);
  if (distance > radius) return '.';
  if (distance > radius - 1) return '1';
  if (dx < -radius * 0.1 && dx > -radius * 0.65 && dy < -radius * 0.15 && dy > -radius * 0.7)
    return '4';
  return Math.hypot(dx + radius * 0.25, dy + radius * 0.3) > radius * 0.78 ? '2' : '3';
}

const sphere = (diameter: number) => draw((dx, dy) => ball(dx, dy, diameter / 2));

const electron = sphere(12);
export const particleArt = { electron, electronSurge: electron };

export const particlePalettes: Record<keyof typeof particleArt, string[]> = {
  electron: ['', '#296175', '#499ab0', '#91dceb', '#e4fcff'],
  electronSurge: ['', '#94702e', '#e0b14f', '#ffe49b', '#ffffe4'],
};

// Frames in src/art/assets/particles.png (16px) and bosses.png (64px), packed by
// `npm run build:art` from assets/particle-art and assets/boss-art.
export const particleFrames: Record<ParticleKind, number> = {
  quark: 0,
  proton: 1,
  muon: 2,
  neutron: 3,
  neutrino: 4,
  meson: 5,
};
export const bossFrames: Record<BossKind, number> = {
  gluon: 0,
  w: 1,
  z: 2,
  tau: 3,
  top: 4,
  higgs: 5,
};
// Body colours of each sprite, used for pops and shards.
export const particleColors: Record<ParticleKind, number> = {
  quark: 0xc4657a,
  proton: 0xd98b45,
  muon: 0x9a86d4,
  neutron: 0x6a8aa0,
  neutrino: 0x9fd8c4,
  meson: 0xa6cc5c,
};
