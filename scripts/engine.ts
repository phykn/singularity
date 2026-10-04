import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

export function sourceHash(): string {
  const hash = createHash('sha256');
  const folder = new URL('../src/game/', import.meta.url);
  for (const file of readdirSync(folder)
    .filter((file) => file.endsWith('.ts'))
    .sort()) {
    hash.update(file).update(readFileSync(new URL(file, folder)));
  }
  return hash.update(readFileSync(new URL('../design/rules.json', import.meta.url))).digest('hex');
}
