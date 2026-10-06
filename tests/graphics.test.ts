import test from 'node:test';
import assert from 'node:assert/strict';
import type Phaser from 'phaser';
import { readFileSync } from 'node:fs';
import {
  beamFrame,
  beamPose,
  beamRows,
  effectFrame,
  effectRows,
  visibleEffects,
} from '../src/render/effects.ts';
import { particleArt, particlePalettes } from '../src/art/particles.ts';
import { createParticleTextures } from '../src/render/particleTextures.ts';
import { healthBar } from '../src/render/healthBars.ts';
import { drawEffect } from '../src/render/drawEffects.ts';
import type { Effect } from '../src/game/types.ts';
import { skillIds, upgradeIds } from '../src/game/rules.ts';
import { iconCells, controlCells, controlIds } from '../src/art/skills.ts';
import { close, target } from './helpers.ts';
import { drawWaveWarning, WARNING_RED } from '../src/render/warning.ts';
import { drawElectronField } from '../src/render/electronField.ts';
import type { EffectPainter } from '../src/render/effects.ts';
import { effectArtwork } from '../assets/effect-art/sprites.mjs';

test('native sprites paint only palette pixels within their texture bounds', () => {
  const textures: string[] = [];
  const scene = {
    textures: {
      createCanvas(key: keyof typeof particleArt, width: number, height: number) {
        const rows = particleArt[key];
        assert.equal(width, 16);
        assert.equal(height, 16);
        assert.equal(width, rows[0].length);
        assert.equal(height, rows.length);
        const painted = new Set<string>();
        const ctx = {
          fillStyle: '',
          fillRect(x: number, y: number, w: number, h: number) {
            assert.ok(x >= 0 && x < width && y >= 0 && y < height);
            assert.equal(w, 1);
            assert.equal(h, 1);
            assert.match(rows[y][x], /^[1-4]$/);
            assert.equal(this.fillStyle, particlePalettes[key][Number(rows[y][x])]);
            painted.add(`${x},${y}`);
          },
        };
        return {
          getContext: () => ctx,
          refresh() {
            rows.forEach((row, y) => {
              assert.equal(row.length, width, key + ' has an uneven row');
              assert.match(row, /^[.1-4]+$/);
              [...row].forEach((pixel, x) => {
                assert.equal(painted.has(`${x},${y}`), pixel !== '.');
              });
            });
            textures.push(key);
          },
        };
      },
    },
  };
  createParticleTextures(scene as unknown as Phaser.Scene);
  assert.deepEqual(textures, Object.keys(particleArt));
});

test('generated icon atlases have transparent-capable PNGs and unique in-bounds cells', () => {
  assert.deepEqual(Object.keys(iconCells).sort(), [...upgradeIds].sort());
  const cells = new Set<string>();
  for (const id of upgradeIds) {
    const { x, y } = iconCells[id],
      cell = `${x},${y}`;
    assert.ok(!cells.has(cell), id);
    cells.add(cell);
    assert.ok(x >= 0 && y >= 0 && x + 32 <= 224 && y + 32 <= 96, id);
    assert.equal((x % 32) + (y % 32), 0, id);
  }
  assert.equal(
    new Set(Object.values(controlCells).map(({ x, y }) => `${x},${y}`)).size,
    controlIds.length,
  );
  for (const { x, y } of Object.values(controlCells)) {
    assert.ok(x >= 0 && y >= 0 && x + 32 <= 128 && y + 32 <= 64);
    assert.equal((x % 32) + (y % 32), 0);
  }
  for (const [path, width, height] of [
    ['../src/art/assets/skills.png', 224, 96],
    ['../src/art/assets/controls.png', 128, 64],
  ] as const) {
    const png = readFileSync(new URL(path, import.meta.url));
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.equal(png[25], 6, 'PNG must preserve alpha');
  }
});

test('health bars show continuous proportional health and hide one-hit particles', () => {
  const enemy = target(1, 180, 200, 8, 'dense');
  const original = structuredClone(enemy);
  assert.deepEqual(healthBar(enemy, 2), { width: 12, height: 1, offset: 10, filled: 12 });
  enemy.hp = 4;
  assert.equal(healthBar(enemy, 2)?.filled, 6);
  enemy.hp = 0.1;
  assert.equal(healthBar(enemy, 2)?.filled, 1);
  assert.ok(healthBar(enemy, 2), 'Tough particles retain the bar until defeated');
  assert.equal(healthBar(enemy, 8), null, 'A power upgrade hides newly one-hit particles');
  enemy.hp = 0;
  assert.equal(healthBar(enemy, 2), null);
  assert.equal(healthBar(target(2, 180, 200, 2), 2), null);
  assert.ok(healthBar(target(3, 180, 200, 2.01), 2));
  assert.equal(original.maxHp, enemy.maxHp);
});

function drawing() {
  const commands: { method: string; args: number[] }[] = [];
  const graphics = new Proxy(
    {},
    {
      get:
        (_, method) =>
        (...args: number[]) => {
          assert.ok(args.every(Number.isFinite), String(method) + ' received invalid geometry');
          commands.push({ method: String(method), args });
          return graphics;
        },
    },
  ) as Phaser.GameObjects.Graphics;
  const paint: EffectPainter = {
    beam: (
      id: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
      progress: number,
      color: number,
      alpha: number,
      height: number,
      rank = 1,
    ) => {
      const args = [from.x, from.y, to.x, to.y, progress, color, alpha, height, rank];
      assert.ok(args.every(Number.isFinite), id + ' received invalid beam geometry');
      commands.push({ method: 'beam:' + id, args });
    },
    sprite: (
      id: string,
      point: { x: number; y: number },
      progress: number,
      color: number,
      alpha: number,
      size = 32,
    ) => {
      commands.push({
        method: 'stamp:' + id,
        args: [point.x, point.y, progress, color, alpha, size],
      });
    },
    contact: (point, color, alpha, radius) => {
      commands.push({ method: 'contact', args: [point.x, point.y, color, alpha, radius] });
    },
  };
  return { graphics, commands, paint };
}
test('wave warnings mark both incoming directions in red and pulse with simulation time', () => {
  const peak = drawing(),
    dim = drawing(),
    paused = drawing();
  drawWaveWarning(peak.graphics, 0, 0, 0.5);
  drawWaveWarning(dim.graphics, 0, 0.25, 0.5);
  drawWaveWarning(paused.graphics, 0, 0.25, 0.5);
  assert.deepEqual(dim.commands, paused.commands);
  const styles = peak.commands.filter((c) => c.method === 'lineStyle');
  assert.equal(styles.length, 2);
  styles.forEach((c) => {
    assert.equal(c.args[0] * 0.5, 3);
    assert.equal(c.args[1], WARNING_RED);
    close(c.args[2], 0.95);
  });
  dim.commands.filter((c) => c.method === 'lineStyle').forEach((c) => close(c.args[2], 0.3));
  assert.equal(peak.commands.filter((c) => c.method === 'strokePath').length, 2);
  const marks = peak.commands.filter((c) => c.method === 'fillRect');
  assert.equal(marks.length, 4);
  assert.ok(marks[0].args[0] > 180 && marks[2].args[0] < 180);
});

const effect: Effect = {
  kind: 'focus',
  arc: { start: 0, sweep: 0.6 },
  source: 'focus',
  from: { x: 10, y: 20 },
  to: { x: 90, y: 100 },
  radius: 50,
  width: 1.5,
  born: 1,
  life: 1,
  rank: 5,
  rarity: 'legendary',
};

test('lightning remains finite at mobile scales and never changes combat data', () => {
  for (const id of skillIds) {
    const kind = [
      'multi',
      'repeat',
      'chain',
      'burst',
      'repel',
      'gather',
      'chase',
      'satellite',
    ].includes(id)
      ? 'bolt'
      : id;
    const fx = { ...effect, source: id, kind } as Effect;
    const before = structuredClone(fx);
    for (const scale of [0.65, 1, 1.75]) {
      const active = drawing();
      drawEffect(
        active.graphics,
        fx,
        kind === 'surge' ? 1.05 : 1.5,
        scale,
        fx.from,
        [],
        active.paint,
      );
      assert.ok(active.commands.length > 0, id + ' must have a visible attack');
      const expired = drawing();
      drawEffect(expired.graphics, fx, 2, scale, fx.from, [], expired.paint);
      assert.equal(expired.commands.length, 0);
      const coincident = drawing();
      drawEffect(
        coincident.graphics,
        { ...fx, to: fx.from },
        1.5,
        scale,
        fx.from,
        [],
        coincident.paint,
      );
    }
    assert.deepEqual(fx, before);
  }
});

test('effect frames stay inside their row, clamp transient animation and freeze with combat time', () => {
  const png = readFileSync(new URL('../src/art/assets/effects.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 96);
  assert.equal(png[25], 6);
  for (const id of Object.keys(effectRows) as (keyof typeof effectRows)[]) {
    const row = effectRows[id] * 4;
    for (const progress of [-1, 0, 0.1, 0.3, 0.6, 1, 3, 30]) {
      const frame = effectFrame(id, progress);
      assert.ok(frame >= row && frame < row + 4);
      assert.equal(effectFrame(id, progress), frame);
    }
  }
  for (const id of ['hit', 'impact', 'dissolve'] as const) {
    assert.equal(effectFrame(id, 0), effectRows[id] * 4);
    assert.equal(effectFrame(id, 1), effectRows[id] * 4 + 3);
  }
});

test('focused lightning follows the current electron and tracked particle', () => {
  const enemy = target(7, 160, 210, 100);
  const electron = { x: 40, y: 60 };
  const fx = { ...effect, anchor: 'electron' as const, targetId: enemy.id };
  const before = structuredClone({ fx, enemy, electron });
  {
    const { graphics, commands, paint } = drawing();
    drawEffect(graphics, fx, 1.5, 1, electron, [enemy], paint);
    const focused = commands.find(({ method }) => method === 'beam:focus');
    assert.ok(focused);
    assert.deepEqual(focused.args.slice(0, 4), [electron.x, electron.y, enemy.x, enemy.y]);
  }
  assert.deepEqual({ fx, enemy, electron }, before);
});

test('returning lightning reconnects to the live electron instead of its old position', () => {
  const fx = {
    ...effect,
    kind: 'return' as const,
    source: 'return' as const,
    endAnchor: 'electron' as const,
  };
  const electron = { x: 220, y: 280 };
  const { graphics, commands, paint } = drawing();
  drawEffect(graphics, fx, 1.8, 1, electron, [], paint);
  const returned = commands.find(({ method }) => method === 'beam:return')!;
  assert.deepEqual(returned.args.slice(0, 4), [fx.from.x, fx.from.y, electron.x, electron.y]);
  const contact = commands.find(({ method }) => method === 'contact')!;
  assert.deepEqual(contact.args.slice(0, 2), [electron.x, electron.y]);
  const piercing = drawing();
  drawEffect(
    piercing.graphics,
    { ...fx, kind: 'pierce', source: 'pierce' },
    1.8,
    1,
    electron,
    [],
    piercing.paint,
  );
  assert.deepEqual(piercing.commands.find((c) => c.method === 'beam:pierce')!.args.slice(0, 4), [
    fx.from.x,
    fx.from.y,
    electron.x,
    electron.y,
  ]);
});

test('satellite echoes and returns follow the actual emitting satellite, including index zero', () => {
  const electron = { x: 180, y: 128 };
  const satellites = [
    { x: 200, y: 120 },
    { x: 162, y: 139 },
  ];
  for (let index = 0; index < satellites.length; index++) {
    const outbound = drawing(),
      inbound = drawing();
    drawEffect(
      outbound.graphics,
      { ...effect, kind: 'bolt', source: 'repeat', anchor: index },
      1.5,
      1,
      electron,
      [],
      outbound.paint,
      132,
      satellites,
    );
    drawEffect(
      inbound.graphics,
      { ...effect, kind: 'return', source: 'return', endAnchor: index },
      1.8,
      1,
      electron,
      [],
      inbound.paint,
      132,
      satellites,
    );
    const origin = outbound.commands.find((c) => c.method.startsWith('beam:'))!;
    const destination = inbound.commands.find((c) => c.method === 'beam:return')!;
    assert.deepEqual(origin.args.slice(0, 2), [satellites[index].x, satellites[index].y]);
    assert.deepEqual(destination.args.slice(2, 4), [satellites[index].x, satellites[index].y]);
  }
});

test('electron aura stays hollow, compact and stationary while charge fills its contour', () => {
  const point = { x: 120, y: 200 };
  for (const scale of [0.65, 1, 1.75]) {
    for (const surging of [false, true]) {
      let previousSweep = 0;
      for (const progress of [0, 0.1, 0.8, 1]) {
        const a = drawing(),
          b = drawing();
        const state = { mode: 'charging' as const, progress, active: false, fired: false };
        drawElectronField(a.graphics, point, 12.25, scale, state, surging, 5, 5);
        drawElectronField(b.graphics, point, 12.25, scale, state, surging, 5, 5);
        assert.deepEqual(a.commands, b.commands);
        assert.ok(
          !a.commands.some((c) => c.method.startsWith('fill') || c.method.startsWith('stamp:')),
        );
        const circles = a.commands.filter((c) => c.method === 'strokeCircle');
        assert.equal(circles.length, surging || progress > 0 ? 2 : 0);
        for (const c of circles) {
          assert.deepEqual(c.args.slice(0, 2), [point.x, point.y]);
          assert.ok(c.args[2] * scale >= 10 && c.args[2] * scale <= 13);
        }
        if (circles.length)
          assert.deepEqual(circles[0], circles[1], 'Glow and contour share one radius');
        const arcs = a.commands.filter((c) => c.method === 'arc');
        assert.equal(arcs.length, progress > 0 ? 1 : 0);
        if (arcs.length) {
          close(arcs[0].args[2], circles[0].args[2]);
          const sweep = arcs[0].args[4] - arcs[0].args[3];
          assert.ok(sweep > previousSweep);
          close(sweep, Math.PI * 2 * progress);
          previousSweep = sweep;
        }
      }
    }
  }
});

test('rapid charging hits display the newest charge level once while their attacks remain visible', () => {
  const effects: Effect[] = Array.from({ length: 8 }, (_, i) => ({
    ...effect,
    kind: 'charge',
    source: 'charge',
    anchor: 'electron',
    born: i / 10,
    width: (i + 1) / 8,
  }));
  const bolt: Effect = { ...effect, kind: 'bolt', source: 'chain' };
  const before = structuredClone(effects);
  const shown = visibleEffects([...effects, bolt]);
  assert.deepEqual(
    shown.filter((fx) => fx.kind === 'charge'),
    [effects.at(-1)],
  );
  assert.ok(shown.includes(bolt));
  assert.deepEqual(effects, before);
});

test('lightning beam heights use whole screen pixels at every viewport scale', () => {
  for (const scale of [0.65, 1, 1.75]) {
    for (const kind of ['bolt', 'strike', 'focus', 'pierce', 'return'] as const) {
      const { graphics, commands, paint } = drawing();
      drawEffect(graphics, { ...effect, kind }, 1.5, scale, effect.from, [], paint);
      const widths = commands
        .filter(({ method }) => method.startsWith('beam:'))
        .map(({ args }) => args[7]);
      assert.ok(widths.length > 0);
      widths.forEach((width) => assert.ok(Math.abs(width - Math.round(width)) < 1e-8, kind));
    }
  }
});

test('beam atlas frames freeze with simulation time and geometry connects both endpoints', () => {
  const png = readFileSync(new URL('../src/art/assets/beams.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 640);
  assert.equal(png[25], 6);
  for (const id of Object.keys(beamRows) as (keyof typeof beamRows)[]) {
    for (let rank = 1; rank <= 5; rank++)
      for (const time of [-1, 0, 0.1, 0.7, 3, 30]) {
        const frame = beamFrame(id, time, rank);
        const row = (rank - 1) * 32 + beamRows[id] * 4;
        assert.ok(frame >= row && frame < row + 4);
        assert.equal(beamFrame(id, time, rank), frame);
      }
  }
  for (const to of [{ x: 90, y: 20 }, { x: 10, y: 200 }, { x: -90, y: -10 }, effect.from]) {
    const pose = beamPose(effect.from, to);
    assert.ok(Object.values(pose).every(Number.isFinite));
    for (const [point, side] of [
      [effect.from, -1],
      [to, 1],
    ] as const) {
      close(pose.x + (side * Math.cos(pose.angle) * pose.length) / 2, point.x);
      close(pose.y + (side * Math.sin(pose.angle) * pose.length) / 2, point.y);
    }
  }
});

test('ranked beam artwork grows in actual ink, stays attached and remains bounded', () => {
  const sheet = effectArtwork().find((s) => s.output.endsWith('/beams.png'))!;
  for (let row = 0; row < 8; row++)
    for (let frame = 0; frame < 4; frame++) {
      let previous = 0;
      for (let tier = 0; tier < 5; tier++) {
        const top = (tier * 8 + row) * 16,
          left = frame * 64;
        const pixels = sheet.pixels.filter(
          ([x, y]) => x >= left && x < left + 64 && y >= top && y < top + 16,
        );
        assert.ok(pixels.length > previous, `Beam ${row} must strengthen at level ${tier + 1}`);
        previous = pixels.length;
        assert.ok(pixels.length <= 400, 'Even the highest rank must leave negative space');
        const cells = new Set(pixels.map(([x, y]) => `${x},${y}`));
        const seen = new Set<string>();
        const queue = [[left + 1, top + 8]];
        while (queue.length) {
          const [x, y] = queue.pop()!;
          const key = `${x},${y}`;
          if (seen.has(key) || !cells.has(key)) continue;
          seen.add(key);
          for (const dx of [-1, 0, 1])
            for (const dy of [-1, 0, 1]) if (dx || dy) queue.push([x + dx, y + dy]);
        }
        assert.equal(seen.size, cells.size, 'Branches must attach to one coherent trunk');
        assert.ok(cells.has(`${left + 62},${top + 8}`), 'Keep the endpoint anchored');
      }
    }
});

test('every offensive skill passes its level to the beam without adding render objects', () => {
  for (const source of skillIds.filter((id) => id !== 'vent')) {
    const kind = ['strike', 'focus', 'bridge', 'return'].includes(source) ? source : 'bolt';
    const counts = [];
    for (let rank = 1; rank <= 5; rank++) {
      const a = drawing();
      drawEffect(
        a.graphics,
        { ...effect, kind, source, rank, arc: { start: 0, sweep: 0.6 } } as Effect,
        1.02,
        1,
        effect.from,
        [],
        a.paint,
      );
      const beams = a.commands.filter((c) => c.method.startsWith('beam:'));
      assert.equal(beams.length, source === 'bridge' ? 4 : 1, source);
      assert.equal(beams[0].args[8], rank, source);
      counts.push(beams.length);
    }
    assert.equal(new Set(counts).size, 1);
  }
});
