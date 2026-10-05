import type { UpgradeId } from '../game/rules.ts';
import { art, palettes } from '../render/pixels.ts';
import { skillColor } from '../render/palette.ts';
import type { ParticleKind } from '../game/particles.ts';
import { glyphPaths } from './glyphs.ts';

export function SkillIcon({ id, size = 24 }: { id: UpgradeId; size?: number }) {
  const pixels = size >= 24 ? 32 : 16;
  const glyph = glyphPaths[id];
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
      <path d={glyph.shape} fillRule="evenodd" />
      <path d={glyph.light} fill="#e5f4ff" />
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
          <path d="M5 1h6v2h2v2h2v6h-2v2h-2v2H5v-2H3v-2H1V5h2V3h2z" />
        </clipPath>
      </defs>
      <path d="M5 1h6v2h2v2h2v6h-2v2h-2v2H5v-2H3v-2H1V5h2V3h2z" fill="currentColor" opacity=".35" />
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
