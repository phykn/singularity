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
      const arc = (radius, angle, length, shade = 2) => {
        for (let a = angle; a <= angle + length; a += 1 / radius)
          pixel(
            Math.round(15.5 + Math.cos(a) * radius),
            Math.round(15.5 + Math.sin(a) * radius),
            shade,
          );
      };
      return { pixel, line, arc };
    },
  };
}

export function effectArtwork() {
  const effects = sheet(128, 192, 32, 32);
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
    const orb = effects.frame(frame, 2);
    for (let y = 10; y <= 21; y++)
      for (let x = 10; x <= 21; x++) {
        const dx = x - 15.5,
          dy = y - 15.5,
          distance = Math.hypot(dx, dy);
        if (distance > 5) continue;
        const shade = distance > 4 ? 1 : dx + dy > 1 ? 2 : 3;
        orb.pixel(x, y, shade);
      }
    orb.pixel(12, 14 + (frame % 2), 3);
    const charge = effects.frame(frame, 3);
    for (const side of [0, Math.PI]) charge.arc(9, side - 0.5 + frame * 0.08, 0.75, 2);
    const surge = effects.frame(frame, 4);
    for (let side = 0; side < 4; side++)
      surge.arc(
        frame === 1 || frame === 2 ? 11 : 10,
        (side * Math.PI) / 2 - 0.3,
        0.6,
        frame === 1 ? 3 : 2,
      );
    const dissolve = effects.frame(frame, 5),
      distance = frame + 2;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      dissolve.pixel(16 + dx * distance, 16 + dy * distance, frame < 2 ? 2 : 1);
  }

  const beams = sheet(256, 128, 64, 16);
  const profiles = [
    [0, 1, -1, 1, 0, -1, 0],
    [0, -1, 2, -1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 2, -2, 2, -1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, -2, 1, -2, 2, -1, 0],
    [0, 0, 1, 0, -1, 0, 0],
    [0, 0, -1, 1, 0, 0, 0],
  ];
  for (let row = 0; row < 8; row++)
    for (let frame = 0; frame < 4; frame++) {
      const beam = beams.frame(frame, row),
        jitter = [0, 1, 0, -1][frame];
      const points = profiles[row].map((y, i) => [
        1 + Math.round((i * 61) / 6),
        8 + y + (i === 2 && row !== 2 && row !== 4 ? jitter : 0),
      ]);
      for (let i = 1; i < points.length; i++)
        beam.line(...points[i - 1], ...points[i], row === 6 ? 2 : 3, row === 3 || row === 5);
      if (row === 2) beam.line(23, 6, 38, 6, 1);
      if (row === 3) beam.line(31, 10, 40, 5, 2);
      if (row === 4) beam.line(14, 6 + (frame % 2), 50, 6 + (frame % 2), 2);
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
