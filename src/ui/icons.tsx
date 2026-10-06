import type { UpgradeId } from '../game/rules.ts';
import { particleFrames } from '../render/particleAtlas.ts';
import particleAtlas from '../render/assets/particles.png';
import type { ParticleKind } from '../game/particles.ts';
import { iconCells } from './iconAtlas.ts';
import skillAtlas from './assets/skills.png';

export function SkillIcon({ id, size = 24 }: { id: UpgradeId; size?: number }) {
  const pixels = size >= 24 ? 32 : 16;
  const cell = iconCells[id];
  return (
    <svg
      className="skill-icon"
      width={pixels}
      height={pixels}
      viewBox="0 0 32 32"
      overflow="hidden"
      aria-hidden="true"
    >
      <image
        href={skillAtlas}
        x={-cell.x}
        y={-cell.y}
        width={224}
        height={96}
        style={{ imageRendering: 'pixelated' }}
      />
    </svg>
  );
}

export function ParticleIcon({ id }: { id: ParticleKind }) {
  const frame = particleFrames[id].index;
  return (
    <svg width={34} height={34} viewBox="0 0 32 32" overflow="hidden" aria-hidden="true">
      <image
        href={particleAtlas}
        x={-(frame % 3) * 32}
        y={-Math.floor(frame / 3) * 32}
        width={96}
        height={64}
        style={{ imageRendering: 'pixelated' }}
      />
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
