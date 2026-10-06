export const effectShades = ['', '#61727d', '#a9bac4', '#f1fcff', '#644425', '#d99540', '#f1fcff'];

// Native pixel artwork: solid cells, shared centers, and no blur or stray texture.
function sheet(width, height, cellWidth, cellHeight) {
  const pixels = new Map();
  return {
    width,
    height,
    pixels,
    frame(col, row) {
      const pixel = (x, y, shade = 3) => {
        if (x < 0 || y < 0 || x >= cellWidth || y >= cellHeight) return;
        const px = col * cellWidth + x,
          py = row * cellHeight + y;
        pixels.set(py * width + px, [px, py, shade]);
      };
      const line = (x, y, toX, toY, shade = 3, thick = false) => {
        const dx = Math.abs(toX - x),
          dy = -Math.abs(toY - y);
        const sx = x < toX ? 1 : -1,
          sy = y < toY ? 1 : -1;
        let error = dx + dy;
        for (;;) {
          pixel(x, y, shade);
          if (thick) pixel(x, y + 1, shade === 3 ? 2 : shade);
          if (x === toX && y === toY) break;
          const twice = error * 2;
          if (twice >= dy) {
            error += dy;
            x += sx;
          }
          if (twice <= dx) {
            error += dx;
            y += sy;
          }
        }
      };
      return { pixel, line };
    },
  };
}

export function effectArtwork() {
  const effects = sheet(128, 96, 32, 32);
  for (let frame = 0; frame < 4; frame++) {
    const hit = effects.frame(frame, 0),
      impact = effects.frame(frame, 1);
    for (const [sprite, radius] of [
      [hit, [1, 2, 3, 3][frame]],
      [impact, [2, 3, 4, 5][frame]],
    ]) {
      if (frame < 2) sprite.pixel(16, 16);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        sprite.pixel(16 + dx * radius, 16 + dy * radius, frame < 2 ? 3 : 2);
        if (sprite === impact && frame < 3)
          sprite.pixel(16 + dx * (radius - 1), 16 + dy * (radius - 1), 2);
      }
    }
    const dissolve = effects.frame(frame, 2),
      distance = frame + 2;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      dissolve.pixel(16 + dx * distance, 16 + dy * distance, frame < 2 ? 2 : 1);
  }

  const beams = sheet(256, 1280, 64, 16);
  // Opposing bends balance the silhouette; unequal shoulders avoid mirror symmetry.
  const profiles = [
    [0, -1, 2, -1, -2, 1, 0],
    [0, -2, 2, 0, -2, 1, 0],
    [0, 0, 1, 0, -1, 0, 0],
    null,
    [0, 0, 1, 0, -1, 0, 0],
    [0, -1, 2, 0, -2, 1, 0],
    [0, 0, 1, 0, -1, 0, 0],
    [0, 1, -2, 0, 2, -1, 0],
  ];
  for (let tier = 0; tier < 10; tier++)
    for (let row = 0; row < 8; row++)
      for (let frame = 0; frame < 4; frame++) {
        const beam = beams.frame(frame, tier * 8 + row);
        const drift = [0, 1, 0, -1][frame];
        if (row === 3) {
          const trunk = [
            [1, 8],
            [11, 5],
            [21, 12 + drift],
            [31, 4],
            [43, 11 - drift],
            [53, 6],
            [62, 8],
          ];
          const halo = [[4, 7], ...trunk.slice(1, -1), [60, 8]];
          for (let i = 1; i < halo.length; i++) {
            for (const y of [-1, 1])
              beam.line(halo[i - 1][0], halo[i - 1][1] + y, halo[i][0], halo[i][1] + y, 4);
          }
          const forks = [
            [trunk[2], [23, 14], [26 + tier, 14]],
            [trunk[3], [28, 2], [25 - Math.floor(tier / 2), 1]],
          ];
          for (const fork of forks)
            for (let i = 1; i < fork.length; i++) beam.line(...fork[i - 1], ...fork[i], 5);
          for (let i = 1; i < trunk.length; i++) beam.line(...trunk[i - 1], ...trunk[i], 6);
          if (tier >= 4)
            for (let i = 1; i < halo.length; i++)
              beam.line(halo[i - 1][0], halo[i - 1][1] + 1, halo[i][0], halo[i][1] + 1, 6);
          continue;
        }
        const points = profiles[row].map((y, i) => [
          [1, 11, 22, 32, 43, 53, 62][i],
          8 + y + (i === 2 ? drift : i === 4 ? -drift : 0),
        ]);
        const width = tier + 1;
        const core = Math.max(1, Math.ceil(width * 0.55));
        for (let i = 1; i < points.length; i++) {
          for (let y = -Math.floor(width / 2); y < Math.ceil(width / 2); y++)
            beam.line(points[i - 1][0], points[i - 1][1] + y, points[i][0], points[i][1] + y, 1);
          for (let y = -Math.floor(core / 2); y < Math.ceil(core / 2); y++)
            beam.line(points[i - 1][0], points[i - 1][1] + y, points[i][0], points[i][1] + y, 3);
        }
      }
  return [
    {
      output: 'src/art/assets/effects.png',
      width: effects.width,
      height: effects.height,
      pixels: [...effects.pixels.values()],
    },
    {
      output: 'src/art/assets/beams.png',
      width: beams.width,
      height: beams.height,
      pixels: [...beams.pixels.values()],
    },
  ];
}
