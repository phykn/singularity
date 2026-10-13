import assert from 'node:assert/strict';
import test from 'node:test';
import { reportDirectory } from '../scripts/browser-support.mjs';

test('browser diagnostics keep flags out of the default report directory', () => {
  for (const args of [[], ['--profile'], ['--live', '--profile'], ['--baseline']])
    assert.equal(reportDirectory('artifacts/default', args), 'artifacts/default');
});

test('browser diagnostics accept an explicit report directory before or after flags', () => {
  for (const args of [
    ['artifacts/custom'],
    ['artifacts/custom', '--frozen'],
    ['--frozen', 'artifacts/custom', '--profile'],
  ])
    assert.equal(reportDirectory('artifacts/default', args), 'artifacts/custom');
});
