import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/app/GameAudio.ts';
import { Game } from '../src/game/Game.ts';
import { SoundMixer } from '../src/app/sounds.ts';
import { soundDefinitions, renderSound } from '../src/app/soundBank.ts';
import type { SoundKind } from '../src/app/soundBank.ts';
import type { SoundCue } from '../src/app/sounds.ts';
import { audioContext } from './audioContext.ts';
import { target } from './helpers.ts';

test('all current cues are finite, bounded and fade to silent sample boundaries', () => {
  for (const rate of [22050, 44100, 48000]) {
    for (const kind of Object.keys(soundDefinitions) as SoundKind[]) {
      const data = renderSound(kind, rate);
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

test('impact variants vary the texture without changing its loudness dramatically', () => {
  const clips = Array.from({ length: soundDefinitions.hit.variants }, (_, i) =>
    renderSound('hit', 48000, i),
  );
  const energy = clips.map((clip) => clip.reduce((sum, sample) => sum + sample ** 2, 0));
  for (let i = 1; i < clips.length; i++) assert.notDeepEqual(clips[0], clips[i]);
  assert.ok(Math.max(...energy) / Math.min(...energy) < 2);
});

test('dense overlap plays every voice and reuses a bounded sample bank', () => {
  const { ctx, sources, buffers, advance } = audioContext();
  const mixer = new SoundMixer(ctx);
  const kinds = Object.keys(soundDefinitions) as SoundKind[];
  let max = 0;
  for (let i = 0; i < 3000; i++) {
    advance(i / 400);
    assert.ok(mixer.play(kinds[i % kinds.length]), 'No voice is discarded during overlap');
    max = Math.max(max, sources.filter((source) => !source.disconnected).length);
  }
  assert.ok(max > 8);
  assert.equal(sources.filter((source) => source.started).length, 3000);
  assert.ok(
    buffers.length <= Object.values(soundDefinitions).reduce((n, spec) => n + spec.variants, 0),
  );
  assert.ok(!mixer.play('unknown'));
  advance(20);
  assert.ok(sources.every((source) => source.disconnected));
  mixer.dispose();
});

test('QTE and combat all play together with gentle foreground emphasis', () => {
  const { ctx, sources, gains, advance } = audioContext();
  const mixer = new SoundMixer(ctx);
  assert.ok(mixer.play('hit'));
  assert.ok(mixer.play('wave'));
  assert.ok(mixer.play('hit'));
  assert.ok(mixer.play('hit'));
  assert.ok(mixer.play('hit'));
  assert.ok(mixer.play('hit'));
  assert.equal(sources.filter((source) => !source.disconnected).length, 6);
  assert.ok(mixer.play('rhythm-complete'));
  advance(0.01);
  assert.ok(mixer.play('rhythm-complete'));
  assert.ok(mixer.play('hit'), 'Particle contacts remain audible during QTE');
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
  mixer.play('preview');
  mixer.play('hit');
  mixer.stop(ctx.currentTime, true);
  assert.ok(sources.every((source) => source.disconnected && source.end === ctx.currentTime));
  assert.ok(gains.slice(1).every((gain) => gain.disconnected));
  assert.ok(mixer.play('hit'), 'Resume does not retain old voice or rate limits');
  mixer.dispose();
  assert.ok(sources.every((source) => source.disconnected));
  assert.ok(graph.every((node) => node.disconnected));
});

test('a wave warning remains audible when growth happens in the same frame', () => {
  const game = new Game(17, { combat: false });
  game.start();
  const { ctx, sources } = audioContext();
  const mixer = new SoundMixer(ctx);
  const audio = new GameAudio();
  Object.assign(audio, { enabled: true, context: { ...ctx, state: 'running' }, mixer });
  const from = game.eventCount;
  game.log('level', null);
  audio.update(game, from);
  assert.equal(sources.length, 0, 'Level-up adds no pop or burst');
  game.log('wave', null);
  audio.update(game, from);
  assert.equal(sources.length, 1, 'Growth does not suppress the wave warning');
  mixer.dispose();
});

test('each actual particle contact creates a sound, including multi-hits and fatal hits', () => {
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
      playBatch(cues: SoundCue[]) {
        played.push(...cues.map((cue) => cue.kind));
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
  assert.deepEqual(played, ['hit']);
  context.currentTime = 10.1;
  audio.update(game, game.eventCount);
  assert.deepEqual(
    played,
    ['hit'],
    'A fatal hit produces one sound, not separate hit and kill sounds',
  );
  const from = game.eventCount;
  game.log('hit', { kind: 'dense', x: 220, y: 260 });
  audio.update(game, from);
  assert.deepEqual(played, ['hit', 'hit'], 'Nonfatal contact also produces a sound');
  const victims = [target(1, 190, 250, 1), target(2, 220, 270, 1), target(3, 140, 260, 1)];
  game.targets = [...victims, target(4, 180, 240, 100)];
  const burst = game.eventCount;
  for (const victim of [...game.targets]) game.damageTarget(victim, 2);
  game.damageTarget(victims[0], 2);
  audio.update(game, burst);
  assert.deepEqual(
    played,
    Array(6).fill('hit'),
    'Each damaged particle plays once, including the surviving target',
  );
  assert.equal(game.targets.length, 1);
});

test('distance softens combat without burying its texture, while QTE stays centered', () => {
  const { ctx, gains, graph, pans, filters, advance } = audioContext();
  const mixer = new SoundMixer(ctx);
  mixer.play('hit', 0, 1, { pan: -0.3, depth: 0 });
  advance(0.3);
  mixer.play('hit', 0.3, 1, { pan: 0.3, depth: 1 });
  const levels = gains.slice(1).map((node) => node.gain.values[0].value);
  assert.ok(levels[1] < levels[0]);
  assert.ok(filters[2].frequency.values[0].value < filters[1].frequency.values[0].value);
  assert.ok(filters[2].frequency.values[0].value >= 3500, 'Far impacts keep their presence');
  advance(0.6);
  mixer.play('rhythm-complete', 0.6, 1, { pan: -1, depth: 1 });
  assert.deepEqual(
    pans.map((node) => node.pan.values[0].value),
    [-0.3, 0.3, 0],
  );
  assert.equal(filters[1].frequency.values[0].value, filters[3].frequency.values[0].value);
  mixer.dispose();
  assert.ok(graph.every((node) => node.disconnected));
});

test('each simultaneous impact keeps its own position, including removed targets', () => {
  const game = new Game(17, { combat: false });
  game.start();
  const cues: { kind: string; space: unknown }[] = [];
  const audio = new GameAudio();
  Object.assign(audio, {
    enabled: true,
    context: { state: 'running', currentTime: 10 },
    mixer: {
      stop() {},
      playBatch(batch: SoundCue[]) {
        for (const { kind, space } of batch) cues.push({ kind, space });
      },
    },
  });
  const point = { x: game.position.x + 15, y: game.position.y };
  game.log('hit', { kind: 'small', x: point.x + 300, y: point.y });
  game.log('hit', { kind: 'small', ...point });
  audio.update(game, 0);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], {
    kind: 'hit',
    space: { pan: (point.x + 300 - 180) / 520, depth: 1 },
  });
  assert.deepEqual(cues[1], { kind: 'hit', space: { pan: (point.x - 180) / 520, depth: 0.05 } });
});

test('keycap contacts stay clear and single taps leave quiet gaps instead of static', () => {
  for (const kind of ['preview', 'hit', 'rhythm-complete'] as const) {
    for (let variant = 0; variant < soundDefinitions[kind].variants; variant++) {
      const clip = renderSound(kind, 48000, variant);
      const energy = clip.reduce((sum, sample) => sum + sample ** 2, 0);
      const fraction = (cutoff: number, high = false) => {
        const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / 48000);
        let low = 0,
          sum = 0;
        for (const sample of clip) {
          low += alpha * (sample - low);
          sum += (high ? sample - low : low) ** 2;
        }
        return sum / energy;
      };
      assert.ok(fraction(250) < 0.45, kind + ' should not be dominated by a bass tone');
      assert.ok(fraction(900, true) > 0.25, kind + ' must expose the contact texture');
      assert.ok(fraction(6000, true) < 0.15, kind + ' should not become sharp hiss');
      const early = clip.slice(0, 48000 * 0.04).reduce((sum, sample) => sum + sample ** 2, 0);
      assert.ok(early / energy > 0.08, kind + ' must respond promptly');
      if (kind === 'preview') {
        const gap = clip.slice(48000 * 0.035, 48000 * 0.045);
        assert.ok(
          gap.reduce((sum, sample) => sum + sample ** 2, 0) / energy < 0.03,
          kind + ' must not fill the contact gap with a noise bed',
        );
        const rest = clip.slice(48000 * 0.11);
        assert.equal(
          rest.reduce((sum, sample) => sum + sample ** 2, 0),
          0,
          'No hiss after release',
        );
      }
      const tail = clip.slice(Math.floor(clip.length * 0.8));
      assert.ok(
        tail.reduce((sum, sample) => sum + sample ** 2, 0) / energy < 0.03,
        kind + ' should not leave a ringing tail',
      );
    }
  }
});

test('QTE and single particle hits respond immediately without extra taps', () => {
  for (let variant = 0; variant < soundDefinitions['rhythm-complete'].variants; variant++) {
    const clip = renderSound('rhythm-complete', 48000, variant);
    const energy = clip.reduce((sum, sample) => sum + sample ** 2, 0);
    const early = clip.slice(0, 48000 * 0.04).reduce((sum, sample) => sum + sample ** 2, 0);
    assert.ok(early / energy > 0.9, 'QTE must respond with one contact');
    assert.ok(
      clip.slice(48000 * 0.065).every((sample) => sample === 0),
      'No return tap or repeated keys',
    );
  }
  const onsets = Array.from(
    { length: soundDefinitions.hit.variants },
    (_, variant) =>
      renderSound('hit', 48000, variant).findIndex((sample) => Math.abs(sample) > 0.001) / 48000,
  );
  assert.ok(Math.max(...onsets) < 0.008, 'The first contact is immediate, not staggered');
});

test('single keycaps shuffle without recent repeats, including across pool boundaries', () => {
  const { ctx, sources, advance } = audioContext();
  const mixer = new SoundMixer(ctx, 1701);
  const heard: unknown[] = [];
  for (let i = 0; i < 80; i++) {
    advance(i * 0.2);
    mixer.play('hit');
    const clip = sources.at(-1)!.buffer;
    assert.ok(!heard.slice(-4).includes(clip), 'No repeat of the last four keycaps');
    heard.push(clip);
  }
  assert.equal(new Set(heard).size, 16);
  assert.notDeepEqual(heard.slice(0, 16), heard.slice(16, 32), 'No fixed round-robin cycle');
  mixer.dispose();
});

test('live contact arrangements vary and have separated transients instead of recorded phrases', () => {
  const { ctx, sources, advance } = audioContext();
  const mixer = new SoundMixer(ctx, 1701);
  const shapes = new Set<string>();
  for (let i = 0; i < 32; i++) {
    advance(i * 0.3);
    assert.equal(mixer.playBatch(Array.from({ length: 3 }, () => ({ kind: 'hit' }))), 3);
    const buffer = sources.at(-1)!.buffer as AudioBuffer;
    const clip = buffer.getChannelData(0);
    assert.ok(buffer.duration < 0.14);
    assert.ok(clip.findIndex((sample) => Math.abs(sample) > 0.001) / ctx.sampleRate < 0.008);
    const step = Math.round(ctx.sampleRate * 0.005);
    const envelope: number[] = [];
    for (let j = 0; j < clip.length - step; j += step)
      envelope.push(
        Math.sqrt(clip.slice(j, j + step).reduce((sum, value) => sum + value ** 2, 0) / step),
      );
    shapes.add(envelope.map((value) => Math.round(value * 10000)).join(','));
    const peaks: number[] = [];
    for (let j = 0; j < envelope.length; j++)
      if (
        envelope[j] > Math.max(...envelope) * 0.35 &&
        envelope[j] >= (envelope[j - 1] ?? 0) &&
        envelope[j] >= (envelope[j + 1] ?? 0) &&
        (!peaks.length || j - peaks.at(-1)! >= 3)
      )
        peaks.push(j);
    assert.ok(peaks.length >= 3, 'Each of three hits retains a distinct contact envelope');
  }
  assert.equal(shapes.size, 32, 'Repeated hit counts do not select a small set of whole phrases');
  mixer.dispose();
});

test('vacuum flow rises smoothly and cuts to silence without a key contact', () => {
  const clip = renderSound('singularity', 48000);
  const energy = (start: number, end: number) =>
    clip.slice(start * 48000, end * 48000).reduce((sum, sample) => sum + sample ** 2, 0);
  assert.ok(energy(0.9, 1.2) > energy(0.1, 0.4) * 2, 'Suction tightens toward the point');
  assert.ok(
    clip.slice(0, 48000 * 0.01).every((sample) => Math.abs(sample) < 0.01),
    'No impact at the start',
  );
});

test('audio consumes new cues once when the recent event window rolls over', () => {
  const game = new Game(17, { combat: false, recordEvents: false });
  game.start();
  const heard: string[] = [];
  const audio = new GameAudio();
  Object.assign(audio, {
    enabled: true,
    context: { state: 'running', currentTime: 10 },
    mixer: {
      stop() {},
      playBatch(cues: SoundCue[]) {
        heard.push(...cues.map((cue) => cue.kind));
      },
    },
  });
  audio.update(game, 0);
  const from = game.eventCount;
  for (let i = 0; i < 1500; i++) game.log('spawn', null);
  game.advance(1000);
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

test('a large same-frame burst contributes every hit to one live mix without death duplicates', () => {
  const game = new Game(17, { combat: false, recordEvents: false });
  game.start();
  const { ctx, sources, advance } = audioContext();
  const mixer = new SoundMixer(ctx);
  const audio = new GameAudio();
  Object.assign(audio, { enabled: true, context: { ...ctx, state: 'running' }, mixer });
  const from = game.eventCount;
  for (let i = 0; i < 1200; i++) {
    game.log('hit', { kind: 'small', x: 200, y: 200 });
    game.log('kill', { kind: 'small', x: 200, y: 200 });
  }
  assert.equal(game.eventCount - game.eventOffset - from, 2400);
  audio.update(game, from);
  assert.equal(sources.length, 1, 'All 1200 hits feed one live mix; deaths add no duplicate sound');
  audio.update(game, game.eventCount);
  assert.equal(sources.length, 1, 'Consumed sounds cannot replay');
  advance(1);
  assert.ok(sources.every((source) => source.disconnected));
  mixer.dispose();
});

test('batch playback preserves individual noncombat cues and stereo positions', () => {
  const cues = Array.from({ length: 480 }, (_, i) => ({
    kind: 'preview',
    space: { pan: Math.sin(i) * 0.35, depth: (i % 17) / 16 },
  }));
  const mixed = audioContext();
  const mixer = new SoundMixer(mixed.ctx);
  assert.equal(mixer.playBatch(cues), cues.length);
  assert.equal(mixed.sources.length, 1);
  const reference = audioContext();
  const singles = new SoundMixer(reference.ctx);
  for (const cue of cues) assert.equal(singles.playBatch([cue]), 1);
  for (const [index, kind] of ['preview'].entries()) {
    const buffer = mixed.sources[index].buffer as AudioBuffer;
    for (const channel of [0, 1]) {
      const expected = new Float64Array(buffer.length);
      for (let i = 0; i < cues.length; i++) {
        if (cues[i].kind !== kind) continue;
        const data = (reference.sources[i].buffer as AudioBuffer).getChannelData(channel);
        for (let j = 0; j < data.length; j++) expected[j] += data[j];
      }
      const actual = buffer.getChannelData(channel);
      for (let i = 0; i < actual.length; i++)
        assert.ok(Math.abs(actual[i] - expected[i]) < 0.00002, 'No contribution is skipped');
    }
  }
  assert.equal(mixer.playBatch([{ kind: 'unknown' }]), 0);
  mixed.advance(1);
  assert.ok(mixed.sources.every((source) => source.disconnected));
  mixer.dispose();
  singles.dispose();
});

test('every simultaneous hit contributes to density, intensity and stereo placement', () => {
  const render = (count: number, pan = 0, depth = 0, only?: number) => {
    const audio = audioContext();
    const mixer = new SoundMixer(audio.ctx, 1701);
    assert.equal(
      mixer.playBatch(
        Array.from({ length: count }, (_, i) => ({
          kind: 'hit',
          space: only === undefined || i === only ? { pan, depth } : { pan: 0, depth: 0 },
        })),
      ),
      count,
    );
    assert.equal(audio.sources.length, 1);
    const buffer = audio.sources[0].buffer as AudioBuffer;
    mixer.dispose();
    return buffer;
  };
  const clips = [1, 2, 3, 4, 12, 480].map((count) => render(count));
  assert.ok(clips[1].length > clips[0].length);
  assert.ok(clips[2].length > clips[1].length);
  const energy = (clip: AudioBuffer, ch = 0) =>
    clip.getChannelData(ch).reduce((sum, value) => sum + value ** 2, 0);
  assert.ok(energy(clips[4]) > energy(clips[3]));
  assert.ok(energy(clips[5]) > energy(clips[4]), 'More hits still contribute beyond four contacts');
  assert.ok(
    energy(clips[5]) < energy(clips[3]) * 12,
    'A crowd does not flatten the attack by summing hundreds of copies',
  );
  assert.ok(
    clips.every((clip) => clip.duration < 0.14),
    'No count-dependent playback queue',
  );
  const left = render(16, -0.35),
    right = render(16, 0.35),
    far = render(16, 0, 1);
  assert.ok(energy(left, 0) > energy(left, 1));
  assert.ok(energy(right, 1) > energy(right, 0));
  assert.ok(energy(far) < energy(render(16)));

  for (const count of [16, 480]) {
    const indices = count === 16 ? Array.from({ length: 16 }, (_, i) => i) : [0, 1, 15, 239, 479];
    for (const index of indices) {
      const clip = render(count, 0.35, 0, index);
      const l = clip.getChannelData(0),
        r = clip.getChannelData(1);
      const difference = l.reduce((sum, value, i) => sum + (value - r[i]) ** 2, 0);
      assert.ok(difference > 1e-12, `Hit ${index} of ${count} contributes its own stereo position`);
    }
  }
});

test('rapid new hits soften old tails once, without delaying or discarding the new run', () => {
  const { ctx, gains, sources, advance } = audioContext();
  const mixer = new SoundMixer(ctx, 1701);
  const cues = Array.from({ length: 16 }, () => ({ kind: 'hit' }));
  assert.equal(mixer.playBatch(cues), 16);
  advance(0.017);
  assert.equal(mixer.playBatch(cues), 16);
  assert.equal(gains[1].gain.values.at(-1)!.value, 0.4);
  const scheduled = gains[1].gain.values.length;
  assert.ok(
    gains[1].gain.values.some((v) => v.method === 'target' && v.at > 0.017 && v.value === 1),
    'Future contacts remain at full level while their intervening tails are softened',
  );
  advance(0.034);
  assert.equal(mixer.playBatch(cues), 16);
  assert.equal(gains[1].gain.values.length, scheduled, 'Older tails are not repeatedly attenuated');
  assert.equal(sources[2].end, ctx.currentTime + sources[2].buffer!.duration);
  mixer.stop(ctx.currentTime, true);
  assert.ok(sources.every((source) => source.disconnected));
  advance(1);
  assert.equal(mixer.playBatch(cues), 16);
  assert.equal(gains.at(-1)!.gain.values[0].value, 1, 'Resume has no old attenuation');
  mixer.dispose();
});

test('tail separation and QTE emphasis preserve contact attacks that are already scheduled', () => {
  const { ctx, gains, advance } = audioContext();
  const mixer = new SoundMixer(ctx, 1701);
  mixer.playBatch(Array.from({ length: 3 }, () => ({ kind: 'hit' })));
  advance(0.005);
  mixer.playBatch([{ kind: 'hit' }]);
  const first = gains[1].gain.values;
  assert.ok(
    first.filter((v) => v.method === 'target' && v.value === 0.4).every((v) => v.at >= 0.014),
    'A new hit never clips the first contact before its attack ends',
  );
  advance(0.017);
  mixer.play('rhythm-complete');
  assert.ok(
    first.some((v) => v.method === 'target' && v.at > 0.017 && v.value === 0.8),
    'QTE emphasis rebuilds protection for future contacts instead of cancelling their attacks',
  );
  mixer.stop(ctx.currentTime, true);
  mixer.dispose();
});

test('time spent constructing a live mix cannot truncate its remaining contacts', () => {
  const { ctx, gains, sources, advance } = audioContext();
  const mixer = new SoundMixer(ctx, 1701);
  const createBuffer = ctx.createBuffer.bind(ctx);
  ctx.createBuffer = (...args: Parameters<typeof createBuffer>) => {
    const buffer = createBuffer(...args);
    advance(ctx.currentTime + 0.02);
    return buffer;
  };
  mixer.playBatch(
    Array.from({ length: 3 }, () => ({ kind: 'hit' })),
    0,
  );
  assert.equal(gains.at(-1)!.gain.values[0].at, ctx.currentTime);
  assert.equal(sources[0].end, ctx.currentTime + sources[0].buffer!.duration);
  mixer.play('singularity', 0);
  assert.equal(sources[1].end, ctx.currentTime + sources[1].buffer!.duration);
  mixer.dispose();
});

test('batched distance filtering and QTE emphasis retain audible spatial detail', () => {
  const { ctx, sources, gains, advance } = audioContext();
  const mixer = new SoundMixer(ctx, 1701);
  const render = (kind: string, pan: number, depth: number) => {
    mixer.playBatch([{ kind, space: { pan, depth } }]);
    return sources.at(-1)!.buffer as AudioBuffer;
  };
  const near = render('hit', -0.35, 0);
  const far = render('hit', 0.35, 1);
  const energy = (buffer: AudioBuffer, channel: number) =>
    buffer.getChannelData(channel).reduce((sum, value) => sum + value ** 2, 0);
  assert.ok(energy(near, 0) > energy(near, 1));
  assert.ok(energy(far, 1) > energy(far, 0));
  assert.ok(energy(far, 0) + energy(far, 1) < energy(near, 0) + energy(near, 1));
  mixer.play('rhythm-complete');
  const qte = render('rhythm-complete', 0.35, 1);
  assert.deepEqual(qte.getChannelData(0), qte.getChannelData(1), 'QTE stays centered');
  render('hit', 0, 0.5);
  assert.equal(gains.at(-1)!.gain.values[0].value, 0.8);
  mixer.stop(ctx.currentTime, true);
  assert.ok(sources.every((source) => source.disconnected));
  render('hit', 0, 0.5);
  assert.equal(gains.at(-1)!.gain.values[0].value, 1, 'Resume retains no old QTE attenuation');
  advance(1);
  mixer.dispose();
});

test('success uses one continuous vacuum cue and stays silent from the point through results', () => {
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
  assert.equal(cues.at(-1), 'singularity');
  const count = cues.length;
  game.advance(600);
  audio.update(game, 0);
  assert.equal(cues.length, count, 'Compression continues the same sound');
  game.phaseTicks = Math.round((game.rules.collisionSeconds - 0.1) * game.rules.tickRate);
  audio.update(game, 0);
  assert.equal(cues.at(-1), 'silence');
  game.advance(150);
  audio.update(game, 0);
  assert.equal(cues.at(-1), 'silence');
  game.advance(450);
  audio.update(game, 0);
  assert.equal(cues.at(-1), 'silence');
  game.advance(4000);
  audio.update(game, 0);
  assert.equal(cues.filter((cue) => cue !== 'silence').length, 1);
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
