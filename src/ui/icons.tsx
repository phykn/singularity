import controlAtlas from '../art/assets/controls.png';
import { controlAtlasSize, controlCells } from '../art/skills.ts';
import type { ControlId } from '../art/skills.ts';

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
        style={{ imageRendering: 'pixelated' }}
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
