import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

export const median = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;

export function sourceHash(): string {
  const hash = createHash('sha256');
  const folder = new URL('../src/game/', import.meta.url);
  for (const file of readdirSync(folder)
    .filter((file) => file.endsWith('.ts'))
    .sort()) {
    hash.update(file).update(readFileSync(new URL(file, folder)));
  }
  for (const file of ['GameSession.ts', 'OrbitRhythm.ts'])
    hash.update(file).update(readFileSync(new URL('../src/app/' + file, import.meta.url)));
  return hash.update(readFileSync(new URL('../design/rules.json', import.meta.url))).digest('hex');
}
