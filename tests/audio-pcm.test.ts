import assert from 'node:assert/strict';
import test from 'node:test';
import { pcm16Base64 } from '../scripts/audio-pcm.mjs';

test('audio export preserves signed PCM16 quantization and stereo interleaving', () => {
  const channels = [
    Float32Array.from([-1, -0.5, 0, 0.5, 1]),
    Float32Array.from([1, 0.25, 0, -0.25, -1]),
  ];
  const actual = Buffer.from(pcm16Base64(channels), 'base64');
  const expected = Buffer.alloc(20);
  for (let i = 0; i < channels[0].length; i++)
    for (let ch = 0; ch < channels.length; ch++)
      expected.writeInt16LE(Math.round(channels[ch][i] * 32767), (i * 2 + ch) * 2);
  assert.deepEqual(actual, expected);
});

test('audio export retains all samples across binary-string chunk boundaries', () => {
  const channels = [
    Float32Array.from({ length: 5003 }, (_, i) => Math.sin(i) * 0.8),
    Float32Array.from({ length: 5003 }, (_, i) => Math.cos(i) * 0.8),
  ];
  const actual = Buffer.from(pcm16Base64(channels), 'base64');
  assert.equal(actual.length, channels[0].length * channels.length * 2);
  for (let i = 0; i < channels[0].length; i++)
    for (let ch = 0; ch < channels.length; ch++)
      assert.equal(actual.readInt16LE((i * 2 + ch) * 2), Math.round(channels[ch][i] * 32767));
});
