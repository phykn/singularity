import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-support.mjs';

// Pack the generated pixel artwork into native UI cells; artistic conversion is already complete.
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  for (const [sourcePath, output, cols, rows, trim, cellWidth, cellHeight] of [
    ['assets/icon-art/pixel-art.png', 'src/art/assets/skills.png', 7, 3, true, 32, 32],
    ['assets/effect-art/pixel-art.png', 'src/art/assets/effects.png', 4, 6, false, 32, 32],
    ['assets/effect-art/beams.png', 'src/art/assets/beams.png', 4, 8, false, 64, 16],
  ]) {
    const source = readFileSync(sourcePath).toString('base64');
    const png = await page.evaluate(
      async ({ source, cols, rows, trim, cellWidth, cellHeight }) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = cols * cellWidth;
        canvas.height = rows * cellHeight;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        // Animated frames retain their shared cell center, including transparent margins.
        if (!trim) {
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/png').split(',')[1];
        }
        const width = image.naturalWidth / cols,
          height = image.naturalHeight / rows;
        const raw = document.createElement('canvas');
        raw.width = image.naturalWidth;
        raw.height = image.naturalHeight;
        const rawCtx = raw.getContext('2d');
        rawCtx.drawImage(image, 0, 0);
        const data = rawCtx.getImageData(0, 0, raw.width, raw.height).data;
        for (let row = 0; row < rows; row++)
          for (let col = 0; col < cols; col++) {
            let left = Infinity,
              top = Infinity,
              right = -1,
              bottom = -1;
            for (let y = Math.ceil(row * height); y < Math.floor((row + 1) * height); y++)
              for (let x = Math.ceil(col * width); x < Math.floor((col + 1) * width); x++) {
                if (data[(y * raw.width + x) * 4 + 3] < 128) continue;
                left = Math.min(left, x);
                top = Math.min(top, y);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
              }
            if (right < left || bottom < top) throw new Error('Empty generated cell');
            const w = right - left + 1,
              h = bottom - top + 1;
            const scale = 28 / Math.max(w, h),
              dw = Math.round(w * scale),
              dh = Math.round(h * scale);
            ctx.drawImage(
              image,
              left,
              top,
              w,
              h,
              col * 32 + Math.floor((32 - dw) / 2),
              row * 32 + Math.floor((32 - dh) / 2),
              dw,
              dh,
            );
          }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { source, cols, rows, trim, cellWidth, cellHeight },
    );
    const buffer = Buffer.from(png, 'base64');
    assert.equal(buffer.readUInt32BE(16), cols * cellWidth);
    assert.equal(buffer.readUInt32BE(20), rows * cellHeight);
    writeFileSync(output, buffer);
    console.log(
      `Packed ${cols * rows} generated sprites into ${cols * cellWidth}×${rows * cellHeight} transparent atlas.`,
    );
  }
} finally {
  await browser.close();
}
