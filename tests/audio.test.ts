import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/app/GameAudio.ts';
import { Game } from '../src/game/Game.ts';
import { KillRhythm, SoundMixer } from '../src/app/sounds.ts';
import { soundDefinitions, synthesizeSound } from '../src/app/soundBank.ts';
import type { SoundKind } from '../src/app/soundBank.ts';
import { audioContext } from './audioContext.ts';

test('all original textures are finite, bounded and fade to silent sample boundaries', () => {
  for (const rate of [22050, 44100, 48000]) {
    for (const kind of Object.keys(soundDefinitions) as SoundKind[]) {
      const data = synthesizeSound(kind, rate);
      assert.equal(data[0], 0, kind);
      assert.equal(data.at(-1), 0, kind);
      let energy = 0;
      for (const sample of data) {
        assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 0.8, kind);
        energy += sample ** 2;
      }
      assert.ok(energy / data.length > 0.0001, kind + ' must be audible');
    }
  }
});

test('kill variants vary the texture without changing its loudness dramatically', () => {
  const clips = Array.from({ length: soundDefinitions.kill.variants }, (_, i) =>
    synthesizeSound('kill', 48000, i),
  );
  const energy = clips.map((clip) => clip.reduce((sum, sample) => sum + sample ** 2, 0));
  for (let i = 1; i < clips.length; i++) assert.notDeepEqual(clips[0], clips[i]);
  assert.ok(Math.max(...energy) / Math.min(...energy) < 2);
});

test('a consumed kill burst cannot replay, and a fresh burst after quiet plays immediately', () => {
  const rhythm = new KillRhythm();
  rhythm.add(200, 0);
  assert.notEqual(rhythm.update(0), null);
  assert.equal(rhythm.update(0.1), null);
  assert.equal(rhythm.update(0.2), null);
  rhythm.reset();
  rhythm.add(1, 0);
  rhythm.update(0);
  rhythm.add(1, 0.3);
  assert.notEqual(rhythm.update(0.3), null);
});

test('dense overlap keeps eight live voices at most and reuses a bounded sample bank', () => {
  const { ctx, sources, buffers, advance } = audioContext();
  const mixer = new SoundMixer(ctx);
  const kinds = Object.keys(soundDefinitions) as SoundKind[];
  let max = 0;
  for (let i = 0; i < 3000; i++) {
    advance(i / 400);
    mixer.play(kinds[i % kinds.length]);
    max = Math.max(max, sources.filter((source) => !source.disconnected).length);
  }
  assert.ok(max > 1 && max <= 8);
  assert.ok(
    buffers.length <= Object.values(soundDefinitions).reduce((n, spec) => n + spec.variants, 0),
  );
  assert.ok(!mixer.play('unknown'));
  advance(20);
  assert.ok(sources.every((source) => source.disconnected));
  mixer.dispose();
});

test('QTE has reserved voices and lowers existing combat sounds without making any louder', () => {
  const { ctx, sources, gains, advance } = audioContext();
  const mixer = new SoundMixer(ctx);
  assert.ok(mixer.play('field'));
  assert.ok(mixer.play('wave'));
  advance(0.13);
  assert.ok(mixer.play('level'));
  advance(0.14);
  assert.ok(mixer.play('dense'));
  advance(0.21);
  assert.ok(mixer.play('hit'));
  assert.ok(mixer.play('kill'));
  assert.equal(sources.filter((source) => !source.disconnected).length, 6);
  assert.ok(mixer.play('rhythm-1'));
  advance(0.27);
  assert.ok(mixer.play('rhythm-2'));
  assert.ok(!mixer.play('spark'), 'Combat cannot take the QTE reserve');
  for (const gain of gains) {
    const initial = gain.gain.values.find((value) => value.method === 'set');
    for (const target of gain.gain.values.filter((value) => value.method === 'target'))
      assert.ok(initial && target.value < initial.value);
  }
  mixer.dispose();
});

test('suspension releases live nodes before the audio clock freezes', () => {
  const { ctx, sources, gains, graph } = audioContext();
  const mixer = new SoundMixer(ctx);
  mixer.play('field');
  mixer.play('kill');
  mixer.stop(ctx.currentTime, true);
  assert.ok(sources.every((source) => source.disconnected && source.end === ctx.currentTime));
  assert.ok(gains.slice(1).every((gain) => gain.disconnected));
  assert.ok(mixer.play('kill'), 'Resume does not retain old voice or rate limits');
  mixer.dispose();
  assert.ok(sources.every((source) => source.disconnected));
  assert.ok(graph.every((node) => node.disconnected));
});

test('a wave warning remains audible when growth happens in the same frame', () => {
  const { ctx } = audioContext();
  const mixer = new SoundMixer(ctx);
  assert.ok(mixer.play('level'));
  assert.ok(mixer.play('wave'));
  mixer.dispose();
});

test('kill groups replace duplicate hit sounds and current skill activations have accents', () => {
  const game = new Game(17, { combat: false });
  game.start();
  const played: string[] = [];
  const context = { state: 'running', currentTime: 10 };
  const audio = new GameAudio();
  Object.assign(audio, {
    enabled: true,
    context,
    mixer: {
      stop() {},
      play(kind: string) {
        played.push(kind);
      },
    },
    play(kind: string) {
      played.push(kind);
    },
  });
  game.log('hit', { kind: 'small', x: 220, y: 260 });
  game.log('kill', { kind: 'small', x: 220, y: 260 });
  game.log('skill-effect', { id: 'strike', rank: 1 });
  audio.update(game, 0);
  assert.deepEqual(played, ['arc', 'kill']);
  context.currentTime = 10.1;
  audio.update(game, game.eventCount);
  assert.deepEqual(played, ['arc', 'kill'], 'No repeated texture after the kill');
  const from = game.eventCount;
  game.log('hit', { kind: 'dense', x: 220, y: 260 });
  audio.update(game, from);
  assert.equal(played.at(-1), 'dense');
});

test('distant combat is quieter and muffled, while QTE stays centered and clear', () => {
  const { ctx, gains, graph, pans, filters, advance } = audioContext();
  const mixer = new SoundMixer(ctx);
  mixer.play('kill', 0, 1, { pan: -0.3, depth: 0 });
  advance(0.3);
  mixer.play('kill', 0.3, 1, { pan: 0.3, depth: 1 });
  const levels = gains.slice(1).map((node) => node.gain.values[0].value);
  assert.ok(levels[1] < levels[0]);
  assert.ok(filters[2].frequency.values[0].value < filters[1].frequency.values[0].value);
  advance(0.6);
  mixer.play('rhythm-1', 0.6, 1, { pan: -1, depth: 1 });
  assert.deepEqual(
    pans.map((node) => node.pan.values[0].value),
    [-0.3, 0.3, 0],
  );
  assert.equal(filters[1].frequency.values[0].value, filters[3].frequency.values[0].value);
  mixer.dispose();
  assert.ok(graph.every((node) => node.disconnected));
});

test('combat sound location follows the nearest fresh impact, including removed targets', () => {
  const game = new Game(17, { combat: false });
  game.start();
  const cues: { kind: string; space: unknown }[] = [];
  const audio = new GameAudio();
  Object.assign(audio, {
    enabled: true,
    context: { state: 'running', currentTime: 10 },
    mixer: {
      stop() {},
      play(kind: string, _at: number, _pitch: number, space: unknown) {
        cues.push({ kind, space });
      },
    },
  });
  const point = { x: game.position.x + 15, y: game.position.y };
  game.log('kill', { kind: 'small', x: point.x + 300, y: point.y });
  game.log('kill', { kind: 'small', ...point });
  audio.update(game, 0);
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0], { kind: 'kill', space: { pan: (point.x - 180) / 520, depth: 0.05 } });
});

test('frequent hits and QTE share a damped low body instead of sharp pitched pings', () => {
  for (const kind of ['hit', 'dense', 'kill', 'rhythm-1', 'rhythm-2', 'rhythm-complete'] as const) {
    const clip = synthesizeSound(kind, 48000);
    const alpha = 1 - Math.exp((-2 * Math.PI * 900) / 48000);
    let low = 0,
      total = 0,
      bass = 0;
    for (const sample of clip) {
      low += alpha * (sample - low);
      total += sample ** 2;
      bass += low ** 2;
    }
    assert.ok(bass / total > 0.65, kind + ' should keep most energy in the soft body');
    const tail = clip.slice(Math.floor(clip.length * 0.8));
    assert.ok(
      tail.reduce((sum, sample) => sum + sample ** 2, 0) / total < 0.03,
      kind + ' should not leave a ringing tail',
    );
  }
});

test('audio consumes new cues once when the recent event window rolls over', () => {
  const game = new Game(17, { combat: false, recordEvents: false });
  game.start();
  const heard: string[] = [];
  const audio = new GameAudio();
  Object.assign(audio, {
    enabled: true,
    context: { state: 'running', currentTime: 10 },
    mixer: { stop() {}, play() {} },
    play(cue: string) {
      heard.push(cue);
    },
  });
  audio.update(game, 0);
  const from = game.eventCount;
  for (let i = 0; i < 1500; i++) game.log('spawn', null);
  game.log('wave', null);
  assert.ok(game.eventOffset > from);
  audio.update(game, from);
  assert.deepEqual(heard, ['wave']);
  audio.update(game, game.eventCount);
  assert.deepEqual(heard, ['wave'], 'Retained cues must not replay');
  const next = game.eventCount;
  game.log('charged', null);
  audio.update(game, next);
  assert.deepEqual(heard, ['wave', 'charged']);
});

test('success audio compresses, goes silent at the point and settles into a low resonance', () => {
  const game = new Game(17, { combat: false });
  game.start();
  game.debugSetXp(game.rules.energyGoal);
  game.advance(1000 / game.rules.tickRate);
  const cues: string[] = [];
  const audio = new GameAudio();
  Object.assign(audio, {
    enabled: true,
    context: { state: 'running', currentTime: 10 },
    mixer: {
      stop() {
        cues.push('silence');
      },
      play(cue: string) {
        cues.push(cue);
      },
    },
  });
  audio.update(game, 0);
  game.advance(600);
  audio.update(game, 0);
  assert.equal(cues.at(-1), 'ending-compress');
  game.phaseTicks = Math.round((game.rules.collisionSeconds - 0.1) * game.rules.tickRate);
  audio.update(game, 0);
  assert.equal(cues.at(-1), 'silence');
  game.advance(150);
  audio.update(game, 0);
  assert.equal(cues.at(-1), 'ending');
  game.advance(450);
  audio.update(game, 0);
  assert.equal(cues.at(-1), 'ending-resonance');
  assert.ok(!cues.includes('level'));
});

test('a pending suspension finishes before the newest audio unlock resumes', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let ctx: Context;
  class Context {
    state = 'suspended';
    release!: () => void;
    constructor() {
      Object.assign(this, audioContext().ctx);
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
      Object.assign(this, audioContext().ctx);
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
      Object.assign(this, audioContext().ctx);
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
