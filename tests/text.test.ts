import assert from 'node:assert/strict';
import test from 'node:test';
import { copy } from '../src/ui/text/index.ts';

// Every leaf as `path: type`, so nested tables are compared too.
function shape(value: unknown, path = ''): string[] {
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, inner]) => shape(inner, `${path}.${key}`));
  if (typeof value === 'string' && !value.trim()) return [`${path}: empty`];
  return [`${path}: ${typeof value}`];
}

test('every text key exists in all four languages', () => {
  const reference = shape(copy.ko).sort();
  for (const [language, text] of Object.entries(copy))
    assert.deepEqual(shape(text).sort(), reference, language);
});
