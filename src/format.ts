export const numberText = (value: number) => String(Number(value.toFixed(2)));
export function formatTime(seconds: number): string {
  const time = Math.max(0, Math.floor(seconds)),
    hours = Math.floor(time / 3600);
  return `${hours ? hours + ':' : ''}${Math.floor((time / 60) % 60)
    .toString()
    .padStart(2, '0')}:${(time % 60).toString().padStart(2, '0')}`;
}
