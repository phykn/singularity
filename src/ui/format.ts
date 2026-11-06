export function formatTime(seconds: number): string {
  const time = Math.max(0, Math.floor(seconds)),
    hours = Math.floor(time / 3600),
    pad = (n: number) => String(n).padStart(2, '0');
  return `${hours ? hours + ':' : ''}${pad(Math.floor(time / 60) % 60)}:${pad(time % 60)}`;
}
