import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { Game } from '../src/game/Game.ts';
import type { Result } from '../src/game/types.ts';

export const median = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;

// Round 1 starts at 0; later starts come from the model's round events.
export const roundStarts = (g: Game) => [
  0,
  ...g.events.filter((e) => e.kind === 'round').map((e) => e.time),
];
// Per round: runs that reached it, losses in it, and its median start time.
export function roundSummary(runs: { lost: boolean; round: number; starts: number[] }[]) {
  const last = Math.max(1, ...runs.map((r) => r.round));
  return Array.from({ length: last }, (_, i) => {
    const reached = runs.filter((r) => r.starts.length > i);
    return {
      round: i + 1,
      runs: reached.length,
      losses: runs.filter((r) => r.lost && r.round === i + 1).length,
      medianStart: median(reached.map((r) => r.starts[i])),
    };
  });
}

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

// The scripts that drove a measurement, hashed beside `sourceHash` for the simulation itself.
export function simulationHash(...files: URL[]): string {
  const hash = createHash('sha256');
  for (const file of files) hash.update(readFileSync(file));
  return hash.digest('hex');
}

// Seeds are uint32; a cohort is `count` consecutive seeds from `start`.
export function checkCohort(count: number, start: number): void {
  assert.ok(Number.isSafeInteger(count) && count > 0, 'Count must be a positive safe integer');
  assert.ok(Number.isSafeInteger(start) && start >= 0, 'Start must be a nonnegative safe integer');
  assert.ok(start + count <= 2 ** 32, 'Seed cohort must fit the uint32 seed range');
}

// Every particle a run generated was killed, absorbed or is still on the field.
export function assertConserved(counts: Result['counts']): void {
  for (const c of Object.values(counts))
    assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
}
