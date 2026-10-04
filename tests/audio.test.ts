import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/app/audio.ts';

test('audio can unlock again after a browser effect cleanup closes the previous context', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const contexts: { state: string }[] = [];
  class Context {
    state = 'suspended';
    constructor() {
      contexts.push(this);
    }
    async resume() {
      if (this.state === 'closed') throw new Error('Closed context');
      this.state = 'running';
    }
    async close() {
      this.state = 'closed';
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous);
    else delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });
  const audio = new GameAudio();
  assert.equal(await audio.unlock(), true);
  audio.destroy();
  assert.equal(audio.enabled, false);
  assert.equal(contexts[0].state, 'closed');
  assert.equal(await audio.unlock(), true);
  assert.equal(contexts.length, 2);
  assert.equal(contexts[1].state, 'running');
  audio.destroy();
});
