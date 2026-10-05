import test from 'node:test';
import assert from 'node:assert/strict';
import { newSeed } from '../src/app/seed.ts';

test('fresh seeds reject both the live run and the last page load, then persist the new seed', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored = '7';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const values = [7, 11, 29, 29, 31];
  t.mock.method(crypto, 'getRandomValues', (array: Uint32Array) => {
    array[0] = values.shift()!;
    return array;
  });
  assert.equal(newSeed(11), 29);
  assert.equal(stored, '29');
  assert.equal(newSeed(), 31);
  assert.equal(stored, '31');
  assert.deepEqual(values, []);
});

test('a blocked seed store still produces a different run from the current one', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('Storage blocked');
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const values = [0, 0xffffffff];
  t.mock.method(crypto, 'getRandomValues', (array: Uint32Array) => {
    array[0] = values.shift()!;
    return array;
  });
  assert.equal(newSeed(0), 0xffffffff);
});
