import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-support.mjs';
import { effectArtwork, effectShades } from '../assets/effect-art/sprites.mjs';
import { packIcons } from './icon-packing.mjs';

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  if (!process.argv.includes('--effects')) {
    // Order follows src/art/skills.ts: stats, recover, 16 skills, 8 pacts, then 16 evolutions.
    const skill = (cell) => ['assets/icon-art/skill-source.png', 4, 4, cell];
    const statPact = (cell) => ['assets/icon-art/stat-pact-source.png', 5, 2, cell];
    const face = (cell) => ['assets/icon-art/interface-source.png', 7, 2, cell];
    const sources = [
      face(0), // power
      face(1), // rate
      face(2), // range
      statPact(0), // crit
      statPact(1), // luck
      face(4), // recover
      // Both skill sheets follow the skill order in design/rules.json.
      ...Array.from({ length: 16 }, (_, i) => skill(i)),
      ...Array.from({ length: 8 }, (_, i) => statPact(i + 2)),
      ...Array.from({ length: 16 }, (_, i) => ['assets/icon-art/evolution-source.png', 4, 4, i]),
    ];
    const layers = new Map();
    sources.forEach(([path, columns, rows, cell], destination) => {
      const layer = layers.get(path) ?? { path, columns, rows, cells: [] };
      layer.cells.push([cell, destination]);
      layers.set(path, layer);
    });
    const png = await packIcons(page, [...layers.values()], 8, 6);
    const buffer = Buffer.from(png, 'base64');
    assert.equal(buffer.readUInt32BE(16), 256);
    assert.equal(buffer.readUInt32BE(20), 192);
    writeFileSync('src/art/assets/skills.png', buffer);
    console.log(`Packed ${sources.length} generated icons into the 256×192 transparent atlas.`);
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
    // Whole cells keep the designed size differences between particles.
    const particles = await packIcons(
      page,
      [
        {
          path: 'assets/particle-art/particle-source.png',
          columns: 6,
          rows: 1,
          whole: true,
          cells: Array.from({ length: 6 }, (_, i) => [i, i]),
        },
      ],
      6,
      1,
      16,
    );
    writeFileSync('src/art/assets/particles.png', Buffer.from(particles, 'base64'));
    console.log('Packed 6 generated particles into the 96×16 transparent atlas.');
    const bosses = await packIcons(
      page,
      [
        {
          path: 'assets/boss-art/middle-source.png',
          columns: 5,
          rows: 1,
          fill: 46,
          cells: Array.from({ length: 5 }, (_, i) => [i, i]),
        },
        {
          path: 'assets/boss-art/final-source.png',
          columns: 1,
          rows: 1,
          fill: 62,
          cells: [[0, 5]],
        },
      ],
      6,
      1,
      64,
    );
    writeFileSync('src/art/assets/bosses.png', Buffer.from(bosses, 'base64'));
    console.log('Packed 6 generated giant particles into the 384×64 transparent atlas.');
    // Browser tab icon, home screen icons and the link preview image.
    mkdirSync('public', { recursive: true });
    for (const [source, width, height, output] of [
      ['assets/icon-art/app-icon-source.png', 32, 32, 'public/favicon.png'],
      ['assets/icon-art/app-icon-source.png', 180, 180, 'public/apple-touch-icon.png'],
      ['assets/icon-art/app-icon-source.png', 512, 512, 'public/icon-512.png'],
      ['assets/icon-art/share-source.png', 1200, 630, 'public/share.png'],
    ]) {
      const png = await page.evaluate(
        async ({ data, width, height }) => {
          const image = new Image();
          image.src = 'data:image/png;base64,' + data;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, width, height);
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { data: readFileSync(source).toString('base64'), width, height },
      );
      writeFileSync(output, Buffer.from(png, 'base64'));
    }
    console.log('Scaled the app icon to 32, 180 and 512 pixels and the 1200×630 share image.');
  }
  for (const sheet of effectArtwork()) {
    const png = await page.evaluate(
      async ({ sheet: { width, height, pixels }, shades }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        for (const [x, y, shade] of pixels) {
          ctx.fillStyle = shades[shade];
          ctx.fillRect(x, y, 1, 1);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { sheet, shades: effectShades },
    );
    writeFileSync(sheet.output, Buffer.from(png, 'base64'));
    console.log(
      `Painted native pixel effects into ${sheet.width}×${sheet.height} transparent atlas.`,
    );
  }
} finally {
  await browser.close();
}
