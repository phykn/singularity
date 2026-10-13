export function pcm16Base64(channels) {
  const count = channels[0].length;
  const bytes = new Uint8Array(count * channels.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++)
    for (let ch = 0; ch < channels.length; ch++)
      view.setInt16((i * channels.length + ch) * 2, Math.round(channels[ch][i] * 32767), true);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(''));
}
