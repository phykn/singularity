import assert from 'node:assert/strict';
import test from 'node:test';
import { readLanguage, readSound, keys } from '../src/session/storage.ts';
import { copy } from '../src/ui/text/index.ts';

test('every text key exists in all four languages', () => {
  const reference = Object.keys(copy.ko).sort();
  for (const [language, text] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(text).sort(), reference, language);
    for (const key of reference) {
      const value = text[key as keyof typeof text];
      assert.equal(typeof value, typeof copy.ko[key as keyof typeof copy.ko], `${language}.${key}`);
      if (typeof value === 'string') assert.ok(value.trim(), `${language}.${key} is empty`);
    }
  }
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
