import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('the page links a tab icon, home screen icons and a link preview that exist', () => {
  const html = readFileSync('index.html', 'utf8');
  const site = 'https://singularity.phykn-kr.workers.dev/';
  const links = [...html.matchAll(/(?:href|content)="([^"]+\.png)"/g)].map((m) => m[1]);
  for (const name of ['favicon.png', 'apple-touch-icon.png', 'icon-512.png', 'share.png'])
    assert.ok(
      links.some((link) => link.endsWith('/' + name)),
      name + ' is linked',
    );
  for (const link of links) {
    const path = 'public/' + link.replace(site, '').replace(/^\//, '');
    assert.ok(existsSync(path), link + ' resolves to ' + path);
  }
  const size = (path: string) => {
    const png = readFileSync(path);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  assert.deepEqual(size('public/favicon.png'), [32, 32]);
  assert.deepEqual(size('public/apple-touch-icon.png'), [180, 180]);
  assert.deepEqual(size('public/icon-512.png'), [512, 512]);
  assert.deepEqual(size('public/share.png'), [1200, 630]);
});
