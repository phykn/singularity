import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base, launchBrowser } from './browser-support.mjs';

const dir = process.argv[2] ?? 'artifacts/audio';
mkdirSync(dir, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(base);
  const clips = await page.evaluate(async () => {
    const { SoundMixer } = await import('/src/app/sounds.ts');
    const plans = [
      {
        name: 'combat',
        seconds: 12,
        events: Array.from({ length: 90 }, (_, i) => {
          const at = 0.3 + i * 0.115 + Math.sin(i * 1.7) * 0.015;
          return [
            { kind: 'hit', at },
            { kind: 'kill', at: at + 0.018, pitch: 0.96 + (i % 7) * 0.014 },
            ...(i % 9 === 0 ? [{ kind: 'dense', at: at + 0.035 }] : []),
            ...(i % 18 === 0 ? [{ kind: 'wave', at: at + 0.05 }] : []),
            ...(i % 16 === 0 ? [{ kind: 'level', at: at + 0.06 }] : []),
            ...(i % 7 === 0 ? [{ kind: 'arc', at: at + 0.04 }] : []),
          ];
        }).flat(),
      },
      {
        name: 'qte',
        seconds: 4,
        events: [
          { kind: 'rhythm-1', at: 0.3 },
          { kind: 'rhythm-2', at: 0.8 },
          { kind: 'rhythm-complete', at: 1.5 },
          { kind: 'rhythm-miss', at: 3 },
        ],
      },
      {
        name: 'textures',
        seconds: 8,
        events: [
          'hit',
          'dense',
          'kill',
          'spark',
          'field',
          'rhythm-1',
          'rhythm-2',
          'rhythm-complete',
        ].map((kind, i) => ({ kind, at: 0.25 + i * 0.9 })),
      },
      {
        name: 'distance',
        seconds: 3,
        events: [
          { kind: 'kill', at: 0.25, space: { pan: -0.3, depth: 0 } },
          { kind: 'kill', at: 1.25, space: { pan: 0.3, depth: 1 } },
          { kind: 'rhythm-1', at: 2.25, space: { pan: 0.3, depth: 1 } },
        ],
      },
      {
        name: 'singularity',
        seconds: 7,
        events: [
          { kind: 'charged', at: 0.2 },
          { stop: true, at: 0.99 },
          { kind: 'ending-compress', at: 1 },
          { stop: true, at: 2 },
          { kind: 'ending', at: 2.1 },
          { stop: true, at: 2.5 },
          { kind: 'ending-resonance', at: 2.5 },
          { stop: true, at: 4.05 },
          { kind: 'beyond-contract', at: 4.1 },
          { stop: true, at: 4.65 },
          { kind: 'beyond-open', at: 4.8 },
        ],
      },
      {
        name: 'pause',
        seconds: 2,
        events: [
          { kind: 'field', at: 0.2 },
          { kind: 'kill', at: 0.21 },
          { stop: true, at: 0.23 },
          { kind: 'kill', at: 1.2 },
        ],
      },
      {
        name: 'overlap',
        seconds: 6,
        events: Array.from({ length: 720 }, (_, i) => ({
          kind: ['hit', 'dense', 'kill', 'arc', 'field', 'surge', 'rhythm-complete', 'level'][
            i % 8
          ],
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
      for (const event of plan.events.sort((a, b) => a.at - b.at)) {
        if (event.stop) mixer.stop(event.at);
        else if (mixer.play(event.kind, event.at, event.pitch ?? 1, event.space)) played++;
      }
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
        plan.name === 'singularity' ? [2.04, 2.09] : plan.name === 'pause' ? [0.28, 1.15] : null;
      if (quiet) {
        for (const ch of channels)
          for (let i = Math.ceil(quiet[0] * 48000); i < quiet[1] * 48000; i++)
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
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
