import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-support.mjs';
import { effectArtwork } from '../assets/effect-art/sprites.mjs';
import { packIcons } from './icon-packing.mjs';

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const png = await packIcons(page, [
    {
      path: 'assets/icon-art/interface-source.png',
      columns: 7,
      rows: 2,
      cells: Array.from({ length: 5 }, (_, i) => [i, i]),
    },
    {
      path: 'assets/icon-art/skill-source.png',
      columns: 4,
      rows: 4,
      cells: Array.from({ length: 16 }, (_, i) => [i, i + 5]),
    },
  ]);
  const buffer = Buffer.from(png, 'base64');
  assert.equal(buffer.readUInt32BE(16), 224);
  assert.equal(buffer.readUInt32BE(20), 96);
  writeFileSync('src/art/assets/skills.png', buffer);
  console.log('Packed 21 generated icons into the 224×96 transparent atlas.');
  const controls = await packIcons(
    page,
    [
      {
        path: 'assets/icon-art/interface-source.png',
        columns: 7,
        rows: 2,
        cells: Array.from({ length: 8 }, (_, i) => [i + 5, i]),
      },
    ],
    4,
    2,
  );
  writeFileSync('src/art/assets/controls.png', Buffer.from(controls, 'base64'));
  console.log('Packed 8 generated controls into the 128×64 transparent atlas.');
  for (const sheet of effectArtwork()) {
    const png = await page.evaluate(
      async ({ sheet: { width, height, pixels } }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const shades = ['', '#61727d', '#a9bac4', '#f1fcff'];
        for (const [x, y, shade] of pixels) {
          ctx.fillStyle = shades[shade];
          ctx.fillRect(x, y, 1, 1);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { sheet },
    );
    writeFileSync(sheet.output, Buffer.from(png, 'base64'));
    console.log(
      `Painted native pixel effects into ${sheet.width}×${sheet.height} transparent atlas.`,
    );
  }
} finally {
  await browser.close();
}
