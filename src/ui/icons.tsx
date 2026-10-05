import type { UpgradeId } from '../game/rules.ts';
import { art, palettes } from '../render/pixels.ts';
import { skillColor } from '../render/palette.ts';
import type { ParticleKind } from '../game/particles.ts';

const skillGlyphs: Record<UpgradeId, { shape: string; light: string; field?: string }> = {
  power: {
    shape: 'M7 1h5L8 6h5L5 15l2-6H2z',
    light: 'M7 1h3v1H7zM6 6h3v2H6z',
  },
  rate: {
    shape: 'M4 2h7v2H5v2H3v4h2v2h6v2H4v-2H2v-2H1V6h1V4h2zM11 1h2v1h2v2h-2v2h-2zM10 6h2v4H6V8h4z',
    light: 'M10 6h2v2h-2z',
  },
  range: {
    shape: 'M1 5h2v6H1zM13 5h2v6h-2zM4 7h5V5h2v2h2v2h-2v2H9V9H4z',
    light: 'M4 7h3v2H4z',
  },
  recover: {
    shape:
      'M5 1h6v2H5zM3 3h2v2H3zM1 5h2v6H1zM3 11h2v2H3zM5 13h6v2H5zM11 11h2v2h-2zM7 7h5V4h2v2h2v4h-2v2h-2V9H7z',
    light: 'M5 6h3v4H5z',
  },
  area: {
    shape:
      'M5 1h6v2h2v2h2v6h-2v2h-2v2H5v-2H3v-2H1V5h2V3h2zM6 3v2H5v1H3v4h2v1h1v2h4v-2h1v-1h2V6h-2V5h-1V3z',
    light: 'M8 5h3L8 8h2l-4 4 1-3H5z',
  },
  repeat: {
    field: 'M5 2h4L6 6h2l-6 7 2-5H2z',
    shape: 'M11 3h4l-3 4h2l-6 7 2-5H8z',
    light: 'M11 3h3v1h-3z',
  },
  multi: {
    shape: 'M3 6h4V4h2V2h5v3h-4v2H8v2h2v2h4v3H9v-2H7v-2H3z',
    light: 'M1 7h3v2H1zM12 2h2v2h-2zM12 12h2v2h-2z',
  },
  chain: {
    shape: 'M6 1h4v4H8v2H6v2H5v4H1V9h2V7h1V5h2zM10 5h2v2h-1v1h2v1h2v4h-4V9H9V7H8V5z',
    light: 'M7 2h2v2H7zM2 10h2v2H2zM12 10h2v2h-2z',
  },
  pierce: {
    shape: 'M1 6h9V3h2v2h2v2h1v2h-1v2h-2v2h-2v-3H1z',
    light: 'M3 7h8v2H3z',
  },
  burst: {
    shape: 'M2 2h3v2h2v2h2V4h2V2h3v3h-2v2h-2v2h2v2h2v3h-3v-2H9v-2H7v2H5v2H2v-3h2V9h2V7H4V5H2z',
    light: 'M6 6h4v4H6z',
  },
  strike: {
    shape: 'M8 1h6L9 7h4L4 15l2-6H2z',
    light: 'M8 1h4v1H8zM6 7h3v2H6z',
  },
  wave: {
    shape: 'M8 1h3v2h2v2h2v6h-2v2h-2v2H8v-2h2v-2h2V5h-2V3H8zM5 4h2v2h2v4H7v2H5v-2h1V6H5z',
    light: 'M1 6h3v4H1z',
  },
  whip: {
    shape: 'M2 13v-3h2V8h3V6h3V5h2V3H7V1h5v1h2v2h1v3h-2v2H9v2H6v2H5v2H2z',
    light: 'M2 11h2v2H2zM8 2h3v1H8z',
  },
  focus: {
    shape: 'M2 2h3v2h3v2h3v1h2v2h-2v1H8v2H5v2H2v-2h3v-2h3V9H2V7h6V6H5V4H2z',
    light: 'M12 5h2v1h1v4h-1v1h-2v-1h-1V6h1z',
  },
};

export function SkillIcon({ id, size = 24 }: { id: UpgradeId; size?: number }) {
  const pixels = size >= 24 ? 32 : 16;
  const glyph = skillGlyphs[id];
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
      {glyph.field && <path d={glyph.field} opacity={0.55} />}
      <path d={glyph.shape} fillRule="evenodd" />
      <path d={glyph.light} fill="#f1fcff" />
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
