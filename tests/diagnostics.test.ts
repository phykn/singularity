import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Beyond diagnostics reject unbounded counts and seeds outside uint32 before simulation', () => {
  for (const [args, message] of [
    [['Infinity'], 'Count must be a positive safe integer'],
    [['1', String(2 ** 32)], 'Seed cohort must fit the uint32 seed range'],
  ] as const) {
    const result = spawnSync(process.execPath, ['scripts/beyond.ts', ...args], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message), result.stderr);
  }
});
