import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const files = ['src/game.ts', 'src/growth.ts', 'src/random.ts', 'src/geometry.ts', 'src/rules.ts', 'design/rules.json'];
export const sourceHash = () => {
  const hash = createHash('sha256');
  for (const path of files) hash.update(path).update(readFileSync(new URL('../' + path, import.meta.url)));
  return hash.digest('hex');
};
