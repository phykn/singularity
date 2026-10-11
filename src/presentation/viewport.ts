export function arenaViewport(width: number, height: number) {
  const scale = Math.min(width, height) / 360;
  return {
    scale,
    centerY: height > width ? Math.max(170 * scale + 8, height * 0.42) : height / 2,
  };
}
