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
  focus: {
    shape: 'M2 2h3v2h3v2h3v1h2v2h-2v1H8v2H5v2H2v-2h3v-2h3V9H2V7h6V6H5V4H2z',
    light: 'M12 5h2v1h1v4h-1v1h-2v-1h-1V6h1z',
  },
  repel: {
    shape: 'M1 6h5V3h2v3h2v4H8v3H6v-3H1zM11 3h2v2h2v6h-2v2h-2v-2h1V5h-1z',
    light: 'M1 7h4v2H1z',
  },
  orb: {
    shape: 'M5 2h6v2h2v2h1v4h-1v2h-2v2H5v-2H3v-2H2V6h1V4h2zM6 4v1H5v2H4v2h1v2h2v1h3v-2h2V6h-2V4z',
    light: 'M6 5h3v3H6z',
  },
  charge: { shape: 'M3 2h10v12H3zM5 4v8h6V4zM6 1h4v2H6zM6 8h4v3H6z', light: 'M6 5h4v2H6z' },
  bridge: {
    shape: 'M1 3h4v4H3v2h2v2h2V8h2v3h2V8h2V6h-2V2h4v5h-2v5h-2v2H7v-2H5v-1H3v-2H1z',
    light: 'M2 4h2v2H2zM12 3h2v2h-2z',
  },
  gather: {
    shape: 'M1 3h3v2h2v2H4V6H1zM12 3h3v3h-3v1h-2V5h2zM1 11h3V9h2v2H4v2H1zM12 9h2v2h1v2h-3v-2h-2V9z',
    light: 'M6 6h4v4H6z',
  },
  stun: { shape: 'M2 4h3v8H2zM11 4h3v8h-3zM7 1h4L8 6h2l-5 8 1-6H4z', light: 'M7 1h3v1H7z' },
  chase: {
    shape: 'M1 6h5V4h2V2h5v2H9v2H7v4h2v2h4v2H8v-2H6v-2H1zM11 6h4v4h-4z',
    light: 'M12 7h2v2h-2z',
  },
  surge: {
    shape: 'M2 10h2V7h2V4h2V1h2v5h2v3h2v4h-2v2H4v-2H2z',
    light: 'M7 7h3l-2 4h2l-4 3 1-3H5z',
  },
  return: {
    shape: 'M2 3h8v2h3v2h2v4h-2v2H5v2H3v-2H1v-2h2V9h2v2h6V9h2V7h-3V5H2z',
    light: 'M2 3h5v2H2zM3 11h2v2H3z',
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
