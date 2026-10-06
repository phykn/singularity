import { readFileSync } from 'node:fs';

// Layout/resampling only: pixel design and transparency come from the generated sources.
export async function packIcons(page, layers, columns = 7, rows = 3) {
  return page.evaluate(
    async ({ layers, columns, rows }) => {
      const canvas = document.createElement('canvas');
      canvas.width = columns * 32;
      canvas.height = rows * 32;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      for (const layer of layers) {
        const image = new Image();
        image.src = 'data:image/png;base64,' + layer.source;
        await image.decode();
        const raw = document.createElement('canvas');
        raw.width = image.naturalWidth;
        raw.height = image.naturalHeight;
        const rawCtx = raw.getContext('2d');
        rawCtx.drawImage(image, 0, 0);
        const pixels = rawCtx.getImageData(0, 0, raw.width, raw.height).data;
        const cellWidth = raw.width / layer.columns,
          cellHeight = raw.height / layer.rows;
        for (const [sourceCell, destinationCell] of layer.cells) {
          const col = sourceCell % layer.columns,
            row = Math.floor(sourceCell / layer.columns);
          let left = Infinity,
            top = Infinity,
            right = -1,
            bottom = -1;
          for (let y = Math.ceil(row * cellHeight); y < Math.floor((row + 1) * cellHeight); y++)
            for (let x = Math.ceil(col * cellWidth); x < Math.floor((col + 1) * cellWidth); x++) {
              if (pixels[(y * raw.width + x) * 4 + 3] < 128) continue;
              left = Math.min(left, x);
              top = Math.min(top, y);
              right = Math.max(right, x);
              bottom = Math.max(bottom, y);
            }
          if (right < left || bottom < top) throw new Error(`Empty icon cell ${sourceCell}`);
          const w = right - left + 1,
            h = bottom - top + 1;
          const scale = 28 / Math.max(w, h),
            dw = Math.round(w * scale),
            dh = Math.round(h * scale);
          const x = (destinationCell % columns) * 32,
            y = Math.floor(destinationCell / columns) * 32;
          ctx.clearRect(x, y, 32, 32);
          ctx.drawImage(
            image,
            left,
            top,
            w,
            h,
            x + Math.floor((32 - dw) / 2),
            y + Math.floor((32 - dh) / 2),
            dw,
            dh,
          );
        }
      }
      return canvas.toDataURL('image/png').split(',')[1];
    },
    {
      layers: layers.map(({ path, ...layer }) => ({
        ...layer,
        source: readFileSync(path).toString('base64'),
      })),
      columns,
      rows,
    },
  );
}
