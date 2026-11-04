import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-support.mjs';
import { effectArtwork, effectShades } from '../assets/effect-art/sprites.mjs';
import { packIcons } from './icon-packing.mjs';

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  if (!process.argv.includes('--effects')) {
    // Order follows src/art/skills.ts: stats, recover, 16 skills, 8 pacts, then 16 evolutions.
    const skill = (cell) => ['assets/icon-art/skill-source.png', 4, 4, cell];
    const added = (cell) => ['assets/icon-art/skill-new-source.png', 4, 2, cell];
    const statPact = (cell) => ['assets/icon-art/stat-pact-source.png', 5, 2, cell];
    const face = (cell) => ['assets/icon-art/interface-source.png', 7, 2, cell];
    const sources = [
      face(0), // power
      face(1), // rate
      face(2), // range
      statPact(0), // crit
      statPact(1), // luck
      face(4), // recover
      skill(0), // repeat
      skill(1), // multi
      skill(2), // chain
      skill(3), // pierce
      skill(4), // burst
      added(6), // strike
      skill(8), // satellite
      skill(9), // charge
      skill(14), // surge
      skill(15), // return
      added(4), // mark
      added(5), // tempo
      added(0), // spark
      added(1), // field
      added(2), // fission
      added(3), // overcharge
      ...Array.from({ length: 8 }, (_, i) => statPact(i + 2)),
      ...Array.from({ length: 16 }, (_, i) => [
        'assets/icon-art/evolution-source.png',
        4,
        4,
        // Evolution sheet order: chain, multi, pierce, satellite, strike, repeat, burst, charge,
        // return, surge, mark, tempo, spark, field, fission, overcharge.
        [5, 1, 0, 2, 6, 4, 3, 7, 9, 8, 10, 11, 12, 13, 14, 15][i],
      ]),
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
