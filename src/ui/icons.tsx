import controlAtlas from '../art/assets/controls.png';
import skillAtlas from '../art/assets/skills.png';
import {
  controlAtlasSize,
  controlCells,
  evolvedCells,
  iconAtlasSize,
  iconCells,
} from '../art/skills.ts';
import type { ControlId } from '../art/skills.ts';
import { isSkill } from '../game/rules.ts';
import type { UpgradeId } from '../game/rules.ts';

const pixelated = { imageRendering: 'pixelated' } as const;

export function SkillIcon({
  id,
  size = 24,
  evolved = false,
}: {
  id: UpgradeId;
  size?: number;
  evolved?: boolean;
}) {
  const pixels = size >= 24 ? 32 : 16,
    cell = evolved && isSkill(id) ? evolvedCells[id] : iconCells[id];
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
        width={iconAtlasSize.width}
        height={iconAtlasSize.height}
        style={pixelated}
      />
    </svg>
  );
}

export function Rank({ value, max, next }: { value: number; max: number; next?: number }) {
  return (
    <span className="rank" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <i key={n} className={n === next ? 'next' : n <= value ? 'on' : ''} />
      ))}
    </span>
  );
}

// One 32px cell of the control atlas fills the viewBox.
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
        width={controlAtlasSize.width}
        height={controlAtlasSize.height}
        style={pixelated}
      />
    </svg>
  );
}

export function SoundIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg width={24} height={24} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 6H5V5H6V4H8V12H6V11H5V10H2Z" fill="currentColor" />
      {enabled ? (
        <path d="M10 6H11V10H10 M12 4H13V5H14V11H13V12H12" fill="none" stroke="currentColor" />
      ) : (
        <path d="M10 6L14 10 M14 6L10 10" fill="none" stroke="currentColor" />
      )}
    </svg>
  );
}
