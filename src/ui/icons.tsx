import { useId } from 'react';
import type { UpgradeId } from '../game/rules.ts';
import { particleArt, particlePalettes } from '../art/particles.ts';
import type { ParticleKind } from '../game/particles.ts';
import { iconCells, controlCells } from '../art/skills.ts';
import type { ControlId } from '../art/skills.ts';
import skillAtlas from '../art/assets/skills.png';
import controlAtlas from '../art/assets/controls.png';

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
  const rows = particleArt[id],
    palette = particlePalettes[id];
  return (
    <svg width={32} height={32} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map(
          (pixel, x) =>
            pixel !== '.' && (
              <rect
                key={y * 20 + x}
                x={x}
                y={y}
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

export function CollapseIcon() {
  return (
    <svg
      className="collapse-symbol"
      width={24}
      height={24}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path
        d="M2 8V5H3V3H5V2H9V3H11V4 M14 7V11H13V13H11V14H7V13H5V12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
      <rect x={7} y={7} width={2} height={2} fill="currentColor" opacity={0.55} />
    </svg>
  );
}

export function ChargeIcon({ progress }: { progress: number }) {
  const clip = useId();
  const y = 32 - Math.floor(Math.max(0, Math.min(1, progress)) * 16) * 2;
  const cell = controlCells.charge;
  const ring = (
    <image
      href={controlAtlas}
      x={-cell.x}
      y={-cell.y}
      width={128}
      height={64}
      style={{ imageRendering: 'pixelated' }}
    />
  );
  return (
    <svg
      className="charge-icon"
      width={32}
      height={32}
      viewBox="0 0 32 32"
      overflow="hidden"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={y} width={32} height={32 - y} />
        </clipPath>
      </defs>
      <g opacity={0.3}>{ring}</g>
      <g clipPath={`url(#${clip})`}>{ring}</g>
    </svg>
  );
}

export function ControlIcon({
  id,
  className,
  size = 24,
}: {
  id: ControlId;
  className?: string;
  size?: number;
}) {
  const cell = controlCells[id];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      overflow="hidden"
      aria-hidden="true"
    >
      <image
        href={controlAtlas}
        x={-cell.x}
        y={-cell.y}
        width={128}
        height={64}
        style={{ imageRendering: 'pixelated' }}
      />
    </svg>
  );
}
