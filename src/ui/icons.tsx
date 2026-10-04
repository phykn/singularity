import { Repeat, SpeedFast, Zap } from 'pixelarticons/react';
import type { ComponentType, SVGProps } from 'react';
import type { SkillId, UpgradeId } from '../game/rules.ts';
import { art, palettes } from '../render/pixels.ts';
import { skillColor } from '../render/palette.ts';
import type { ParticleKind } from '../game/particles.ts';

const statIcons: Partial<Record<UpgradeId, ComponentType<SVGProps<SVGSVGElement>>>> = {
  power: Zap,
  rate: Repeat,
  accel: SpeedFast,
};
const skillPaths: Record<SkillId, string> = {
  area: 'M5 1h6v1H5zM2 3h2v2H2zM12 3h2v2h-2zM1 6h1v4H1zM14 6h1v4h-1zM2 11h2v2H2zM12 11h2v2h-2zM5 14h6v1H5zM7 3h2v3H7zM3 7h3v2H3zM10 7h3v2h-3zM7 10h2v3H7z',
  repeat: 'M4 0h4L4 5h3L0 12l2-5H0zM11 2h4l-4 5h3l-7 7 2-5H7z',
  multi: 'M3 7h4v2H3zM6 5h2v2H6zM8 3h4v2H8zM7 7h5v2H7zM6 9h2v2H6zM8 11h4v2H8z',
  chain: 'M4 3h3v2H4zM6 4h2v3H6zM9 8h2v2H9zM10 9h2v3h-2z',
  pierce: 'M0 7h12V5h2v2h2v2h-2v2h-2V9H0z',
  burst:
    'M3 3h2v2H3zM4 4h2v2H4zM10 4h2v2h-2zM11 3h2v2h-2zM3 11h2v2H3zM4 10h2v2H4zM10 10h2v2h-2zM11 11h2v2h-2z',
  strike: 'M8 0h5v2h-3v2H8v2h4v2h-2v2H8v2H6V8H3V6h2V4h3z',
  wave: 'M7 0h2v3H7zM6 1h1v1H6zM9 1h1v1H9zM0 7h3v2H0zM1 6h1v1H1zM1 9h1v1H1zM13 7h3v2h-3zM14 6h1v1h-1zM14 9h1v1h-1zM7 13h2v3H7zM6 14h1v1H6zM9 14h1v1H9zM5 4h6v1H5zM4 5h1v6H4zM11 5h1v6h-1zM5 11h6v1H5z',
  whip: 'M4 2h6v1H4zM10 3h3v2h-3zM13 5h2v5h-2zM12 10h2v2h-2zM4 10h3v2H4zM7 8h3v2H7zM10 6h3v2h-3z',
  focus:
    'M2 7h8v2H2zM9 3h3v1H9zM8 4h1v2H8zM14 4h1v2h-1zM12 3h2v1h-2zM8 10h1v2H8zM9 12h3v1H9zM14 10h1v2h-1zM12 12h2v1h-2z',
};
const skillTargets: Record<SkillId, string> = {
  area: 'M7 6h2v1h1v2H9v1H7V9H6V7h1z',
  repeat: 'M4 13h6v1h1v1H3v-1h1z',
  multi: 'M0 7h3v2H0zM12 2h3v3h-3zM12 7h3v3h-3zM12 12h3v3h-3z',
  chain: 'M1 1h3v3H1zM7 6h3v3H7zM12 12h3v3h-3z',
  pierce: 'M4 4h3v1H5v6h2v1H4zM9 4h3v1h-2v6h2v1H9z',
  burst:
    'M5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM9 5h2v2H9zM5 9h2v2H5zM0 0h3v3H0zM13 0h3v3h-3zM0 13h3v3H0zM13 13h3v3h-3z',
  strike: 'M5 13h5v1h2v1H3v-1h2z',
  wave: 'M7 7h2v2H7z',
  whip: 'M1 12h3v3H1z',
  focus: 'M11 6h2v1h1v2h-1v1h-2V9h-1V7h1z',
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
        shapeRendering="crispEdges"
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
      <path d={skillTargets[id as SkillId]} fill="#f1fcff" />
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
