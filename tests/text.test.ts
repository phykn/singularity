import assert from 'node:assert/strict';
import test from 'node:test';
import { readLanguage, readSound, keys } from '../src/session/storage.ts';
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

function storage(values: Record<string, string> = {}): Storage {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => void (values[key] = value),
  } as Storage;
}

test('language: saved value, then browser language, then English', () => {
  assert.equal(readLanguage(storage({ [keys.language]: '"ja"' }), ['ko-KR']), 'ja');
  assert.equal(readLanguage(storage({ [keys.language]: '"fr"' }), ['zh-TW']), 'zh');
  assert.equal(readLanguage(storage(), ['fr-FR', 'ko']), 'en');
  assert.equal(readLanguage(storage({ [keys.language]: '{' }), []), 'en');
});

test('sound is on unless saved off', () => {
  assert.equal(readSound(storage()), true);
  assert.equal(readSound(storage({ [keys.sound]: 'false' })), false);
  assert.equal(readSound(storage({ [keys.sound]: 'nonsense' })), true);
});
