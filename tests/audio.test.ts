import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/app/audio.ts';

test('a pending suspension finishes before the newest audio unlock resumes', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let ctx: Context;
  class Context {
    state = 'suspended';
    release!: () => void;
    constructor() {
      ctx = this;
    }
    async resume() {
      this.state = 'running';
    }
    async suspend() {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
      this.state = 'suspended';
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous);
    else delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });
  const audio = new GameAudio();
  await audio.unlock();
  audio.suspend();
  const latest = audio.unlock();
  await Promise.resolve();
  ctx!.release();
  assert.equal(await latest, true);
  assert.equal(ctx!.state, 'running');
  assert.equal(audio.enabled, true);
});

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

test('a delayed audio resume cannot undo suspension or affect a replacement context', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const contexts: Context[] = [];
  class Context {
    state = 'suspended';
    release!: () => void;
    reject!: (error: Error) => void;
    constructor() {
      contexts.push(this);
    }
    async resume() {
      await new Promise<void>((resolve, reject) => {
        this.release = resolve;
        this.reject = reject;
      });
      if (this.state === 'closed') throw new Error('Closed context');
      this.state = 'running';
    }
    async suspend() {
      this.state = 'suspended';
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
  const first = audio.unlock();
  audio.suspend();
  contexts[0].release();
  assert.equal(await first, null);
  assert.equal(contexts[0].state, 'suspended');
  assert.equal(audio.enabled, false);
  const stale = audio.unlock();
  audio.destroy();
  const latest = audio.unlock();
  contexts[1].release();
  assert.equal(await latest, true);
  contexts[0].release();
  assert.equal(await stale, null);
  assert.equal(audio.enabled, true);
  assert.equal(contexts[1].state, 'running');
  const obsolete = audio.unlock();
  const reject = contexts[1].reject;
  const current = audio.unlock();
  contexts[1].release();
  assert.equal(await current, true);
  reject(new Error('Obsolete request failed'));
  assert.equal(await obsolete, null);
  assert.equal(audio.enabled, true);
  audio.destroy();
});
