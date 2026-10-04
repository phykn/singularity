import { Repeat, SpeedFast, Zap } from 'pixelarticons/react';
import type { ComponentType, SVGProps } from 'react';
import type { UpgradeId } from '../game/rules.ts';
import { art, palettes } from '../render/pixels.ts';
import { skillColor } from '../render/palette.ts';
import type { ParticleKind } from '../game/particles.ts';

const statIcons: Partial<Record<UpgradeId, ComponentType<SVGProps<SVGSVGElement>>>> = {
  power: Zap,
  rate: Repeat,
  accel: SpeedFast,
};
const skillPaths = {
  area: 'M6 1h5v2H6zM3 3h3v2H3zM11 3h3v2h-3zM1 5h2v6H1zM14 5h2v6h-2zM3 11h3v2H3zM11 11h3v2h-3zM6 13h5v2H6zM7 5h3v2H8v2h2v2H6V8h1z',
  repeat:
    'M1 2h4v2H3v2H1zM6 2h4v2H8v2H6zM11 2h4v2h-2v2h-2zM1 9h4v2H3v3H1zM6 9h4v2H8v3H6zM11 9h4v2h-2v3h-2z',
  multi:
    'M1 6h3v4H1zM4 7h3v2H4zM7 3h2v10H7zM9 3h3v2H9zM9 7h3v2H9zM9 11h3v2H9zM12 2h3v4h-3zM12 6h3v4h-3zM12 10h3v4h-3z',
  chain: 'M1 1h4v4H1zM5 3h2v2H5zM7 5h2v2H7zM6 7h4v4H6zM10 9h2v2h-2zM12 11h3v4h-4v-4z',
  pierce: 'M1 7h12V4h2v2h1v4h-1v2h-2V9H1zM4 2h2v4H4zM4 10h2v4H4zM9 2h2v4H9zM9 10h2v4H9z',
  burst:
    'M7 1h2v4H7zM1 7h4v2H1zM11 7h4v2h-4zM7 11h2v4H7zM5 5h2v2H5zM9 5h2v2H9zM7 7h2v2H7zM5 9h2v2H5zM9 9h2v2H9z',
  strike: 'M7 0h6v2h-2v2H9v2h4v2h-2v2H9v2H7v3H5v-5h2V8H3V6h2V4h2zM1 14h3v2H1zM10 14h5v2h-5z',
  wave: 'M5 1h6v2H5zM2 3h3v2H2zM11 3h3v2h-3zM0 5h2v6H0zM14 5h2v6h-2zM2 11h3v2H2zM11 11h3v2h-3zM5 13h6v2H5zM6 5h4v2h2v3h-2v2H6v-2H4V7h2z',
  whip: 'M1 11h4v4H1zM4 9h2v3H4zM6 7h2v3H6zM8 3h2v5H8zM10 1h4v2h-4zM14 3h2v7h-2zM11 10h3v2h-3z',
  focus: 'M1 5h3v6H1zM5 6h7v1H5zM5 9h7v1H5zM4 7h8v2H4zM12 3h3v2h-3zM12 11h3v2h-3zM14 5h2v6h-2z',
};

export function SkillIcon({ id, size = 24 }: { id: UpgradeId; size?: number }) {
  const Icon = statIcons[id];
  if (Icon)
    return (
      <Icon
        className="skill-icon"
        style={{ color: skillColor(id) }}
        width={size <= 16 ? 12 : 24}
        height={size <= 16 ? 12 : 24}
        aria-hidden="true"
      />
    );
  const pixels = size >= 24 ? 32 : 16;
  return (
    <svg
      className="skill-icon"
      style={{ color: skillColor(id) }}
      width={pixels}
      height={pixels}
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path d={skillPaths[id as keyof typeof skillPaths]} />
    </svg>
  );
}

export function ParticleIcon({ id }: { id: ParticleKind }) {
  const rows = art[id],
    palette = palettes[id];
  return (
    <svg width={34} height={34} viewBox="0 0 17 17" shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map(
          (pixel, x) =>
            pixel !== '.' && (
              <rect
                key={y * 20 + x}
                x={x + Math.floor((17 - row.length) / 2)}
                y={y + Math.floor((17 - rows.length) / 2)}
                width={1}
                height={1}
                fill={palette[Number(pixel)]}
              />
            ),
        ),
      )}
    </svg>
  );
}

export function ChargeIcon({ progress }: { progress: number }) {
  const y = 16 - Math.floor(progress * 8) * 2;
  return (
    <svg
      className="charge-icon"
      width={32}
      height={32}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="charge-pixels">
          <path d="M5 1h6v2h3v3h1v5h-2v3h-3v1H5v-2H2v-3H1V5h2V2h2z" />
        </clipPath>
      </defs>
      <path d="M5 1h6v2h3v3h1v5h-2v3h-3v1H5v-2H2v-3H1V5h2V2h2z" fill="currentColor" opacity=".25" />
      <rect
        x="0"
        y={y}
        width="16"
        height={16 - y}
        fill="currentColor"
        clipPath="url(#charge-pixels)"
      />
      <path d="M6 4h4v2h2v4h-2v2H6v-2H4V6h2z" fill="#080a0e" />
    </svg>
  );
}
