import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base, launchBrowser } from './browser-support.mjs';

const dir = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'artifacts/audio';
mkdirSync(dir, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.route('**/src/app/sounds.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
      const batch = SoundMixer.prototype.playBatch;
      SoundMixer.prototype.playBatch = function(...args) {
        const accepted = batch.apply(this, args);
        if (window.audioBurst) window.audioBurst.accepted += accepted;
        return accepted;
      };`,
    });
  });
  await page.goto(base);
  const clips = process.argv.includes('--live-only')
    ? []
    : await page.evaluate(async () => {
        const { SoundMixer } = await import('/src/app/sounds.ts');
        for (const depth of [0, 0.0625, 0.25, 0.5625, 1]) {
          const cues = ['preview', 'hit', 'preview'].map((kind, i) => ({
            kind,
            space: { depth, pan: (i - 1) * 0.35 },
          }));
          const render = async (batch) => {
            const ctx = new OfflineAudioContext(2, 24000, 48000);
            const mixer = new SoundMixer(ctx);
            if (batch) mixer.playBatch(cues, 0.1);
            else for (const cue of cues) mixer.play(cue.kind, 0.1, 1, cue.space);
            return ctx.startRendering();
          };
          const reference = await render(false),
            mixed = await render(true);
          let difference = 0,
            energy = 0;
          for (const channel of [0, 1]) {
            const a = reference.getChannelData(channel),
              b = mixed.getChannelData(channel);
            for (let i = 0; i < a.length; i++) {
              difference += (a[i] - b[i]) ** 2;
              energy += a[i] ** 2;
            }
          }
          const error = Math.sqrt(difference / energy);
          if (error > 0.02)
            throw new Error(`Batched audio changed the original waveform: ${depth}, ${error}`);
        }
        const plans = [
          {
            name: 'combat',
            seconds: 12,
            events: Array.from({ length: 90 }, (_, i) => {
              const at = 0.3 + i * 0.115 + Math.sin(i * 1.7) * 0.015;
              return [
                { kind: 'hit', at },
                ...(i % 18 === 0 ? [{ kind: 'wave', at: at + 0.05 }] : []),
              ];
            }).flat(),
          },
          {
            name: 'qte',
            seconds: 4,
            events: [{ kind: 'rhythm-complete', at: 1.5 }],
          },
          {
            name: 'textures',
            seconds: 5,
            events: ['preview', 'hit', 'hit', 'hit', 'rhythm-complete'].map((kind, i) => ({
              kind,
              at: 0.25 + i * 0.9,
            })),
          },
          {
            name: 'distance',
            seconds: 3,
            events: [
              { kind: 'hit', at: 0.25, space: { pan: -0.3, depth: 0 } },
              { kind: 'hit', at: 1.25, space: { pan: 0.3, depth: 1 } },
              { kind: 'rhythm-complete', at: 2.25, space: { pan: 0.3, depth: 1 } },
            ],
          },
          {
            name: 'singularity',
            seconds: 7,
            events: [
              { kind: 'singularity', at: 0.25 },
              { stop: true, at: 1.7 },
              { kind: 'beyond-contract', at: 4.1 },
              { stop: true, at: 4.65 },
              { kind: 'beyond-open', at: 4.8 },
            ],
          },
          {
            name: 'pause',
            seconds: 2,
            events: [
              { kind: 'hit', at: 0.2 },
              { kind: 'hit', at: 0.21 },
              { stop: true, at: 0.23 },
              { kind: 'hit', at: 1.2 },
            ],
          },
          {
            name: 'burst',
            seconds: 2,
            events: Array.from({ length: 480 }, (_, i) => ({
              kind: 'hit',
              at: 0.2,
              space: { pan: Math.sin(i) * 0.3, depth: 0 },
            })),
          },
          {
            name: 'typing',
            seconds: 8,
            events: [1, 2, 3, 4, 16, 480]
              .map((count, i) => ({
                kind: 'hit',
                count,
                at: 0.25 + i,
              }))
              .concat(
                Array.from({ length: 45 }, (_, i) => ({
                  kind: 'hit',
                  count: 16,
                  at: 6.3 + i / 60,
                })),
              ),
          },
          {
            name: 'overlap',
            seconds: 6,
            events: Array.from({ length: 720 }, (_, i) => ({
              kind: ['hit', 'hit', 'hit', 'hit', 'wave', 'rhythm-complete'][i % 6],
              at: 0.2 + i / 160,
            })),
          },
        ];
        const results = [];
        for (const plan of plans) {
          const ctx = new OfflineAudioContext(2, plan.seconds * 48000, 48000);
          const start = performance.now();
          const mixer = new SoundMixer(ctx);
          const initMs = performance.now() - start;
          let played = 0;
          if (plan.name === 'burst') played = mixer.playBatch(plan.events, 0.2);
          for (const event of plan.name === 'burst'
            ? []
            : plan.events.sort((a, b) => a.at - b.at)) {
            if (event.stop) mixer.stop(event.at);
            else if (event.count)
              played += mixer.playBatch(
                Array.from({ length: event.count }, () => ({
                  kind: event.kind,
                })),
                event.at,
              );
            else if (mixer.play(event.kind, event.at, event.pitch ?? 1, event.space)) played++;
          }
          if (
            played !==
            plan.events.reduce((n, event) => n + (event.stop ? 0 : (event.count ?? 1)), 0)
          )
            throw new Error(plan.name + ' discarded audio events');
          const audio = await ctx.startRendering();
          let peak = 0,
            sum = 0,
            edge = 0;
          const channels = Array.from({ length: audio.numberOfChannels }, (_, ch) => {
            const data = audio.getChannelData(ch);
            for (let i = 0; i < data.length; i++) {
              assertFinite(data[i]);
              peak = Math.max(peak, Math.abs(data[i]));
              sum += data[i] ** 2;
              if (i) edge = Math.max(edge, Math.abs(data[i] - data[i - 1]));
            }
            return Array.from(data);
          });
          const quiet =
            plan.name === 'singularity'
              ? [
                  [1.74, 4.09],
                  [4.69, 4.79],
                  [5.45, 6.95],
                ]
              : plan.name === 'pause'
                ? [[0.28, 1.15]]
                : [];
          for (const [start, end] of quiet) {
            for (const ch of channels)
              for (let i = Math.ceil(start * 48000); i < end * 48000; i++)
                if (Math.abs(ch[i]) > 0.00001) throw new Error(plan.name + ' must go silent');
          }
          results.push({
            name: plan.name,
            seconds: plan.seconds,
            played,
            initMs,
            peak,
            rms: Math.sqrt(sum / (audio.length * audio.numberOfChannels)),
            edge,
            channels,
          });
        }
        function assertFinite(value) {
          if (!Number.isFinite(value)) throw new Error('Non-finite audio sample');
        }
        return results;
      });
  for (const clip of clips) {
    assert.ok(clip.played > 0);
    assert.ok(clip.peak > 0 && clip.peak < 0.95, `${clip.name} has no clipping headroom`);
    const count = clip.channels[0].length,
      channels = clip.channels.length;
    const wav = Buffer.alloc(44 + count * channels * 2);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(channels, 22);
    wav.writeUInt32LE(48000, 24);
    wav.writeUInt32LE(48000 * channels * 2, 28);
    wav.writeUInt16LE(channels * 2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < count; i++)
      for (let ch = 0; ch < channels; ch++)
        wav.writeInt16LE(Math.round(clip.channels[ch][i] * 32767), 44 + (i * channels + ch) * 2);
    writeFileSync(join(dir, `${clip.name}.wav`), wav);
  }
  const report = clips.map(({ channels, ...result }) => result);
  if (report.length) {
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }

  await page.evaluate(() => {
    const Native = AudioContext;
    window.audioBurst = { contexts: [], accepted: 0, started: 0, active: 0, max: 0 };
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        window.audioBurst.contexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source),
          disconnect = source.disconnect.bind(source);
        let live = false;
        const release = () => {
          if (live) window.audioBurst.active--;
          live = false;
        };
        source.disconnect = (...args) => {
          release();
          return disconnect(...args);
        };
        source.start = (...args) => {
          const probe = window.audioBurst;
          probe.started++;
          probe.active++;
          live = true;
          probe.max = Math.max(probe.max, probe.active);
          source.addEventListener('ended', release, { once: true });
          return start(...args);
        };
        return source;
      }
    };
  });
  await page.locator('.title-sound').click();
  await page.waitForFunction(
    () => window.audioBurst.started === 1 && window.audioBurst.active === 0,
  );
  await page.evaluate(() => window.__gameDebug.restart(17, false));
  await page.waitForFunction(
    () =>
      window.__gameDebug.getModel().time > 0 && window.audioBurst.contexts[0].state === 'running',
  );
  await page.evaluate(() => {
    const game = window.__gameDebug.getModel();
    for (let i = 0; i < 480; i++) {
      const point = { kind: 'small', x: 180 + Math.sin(i) * 100, y: 260 + Math.cos(i) * 100 };
      game.log('hit', point);
      game.log('kill', point);
      game.log('skill-effect', { id: 'strike', rank: 1 });
    }
  });
  await page.waitForFunction(() => window.audioBurst.accepted === 480);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.waitForFunction(
    () => window.audioBurst.active === 0 && window.audioBurst.contexts[0].state === 'suspended',
  );
  const live = await page.evaluate(() => ({
    events: window.audioBurst.accepted,
    sources: window.audioBurst.started - 1,
    maxSimultaneous: window.audioBurst.max,
    activeAfterPause: window.audioBurst.active,
  }));
  assert.equal(live.events, 480);
  assert.equal(
    live.sources,
    1,
    'Every hit contributes to the typing run; deaths and shots add no duplicate sounds',
  );
  assert.equal(live.activeAfterPause, 0);
  writeFileSync(join(dir, 'live-burst.json'), JSON.stringify(live, null, 2) + '\n');
  console.log(JSON.stringify({ liveBurst: live }));
} finally {
  await browser.close();
}
