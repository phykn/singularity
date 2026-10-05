import test from 'node:test';
import assert from 'node:assert/strict';
import type Phaser from 'phaser';
import { art, createPixels, palettes } from '../src/render/pixels.ts';
import { healthBar } from '../src/render/health.ts';
import { drawEffect, drawOrb } from '../src/render/lightning.ts';
import type { Effect } from '../src/game/types.ts';
import { skillIds, upgradeIds } from '../src/game/rules.ts';
import { glyphs, glyphPaths } from '../src/ui/glyphs.ts';
import { close, target } from './helpers.ts';

test('native sprites paint only palette pixels within their texture bounds', () => {
  const textures: string[] = [];
  const scene = {
    textures: {
      createCanvas(key: keyof typeof art, width: number, height: number) {
        const rows = art[key];
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
            assert.equal(this.fillStyle, palettes[key][Number(rows[y][x])]);
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
  createPixels(scene as unknown as Phaser.Scene);
  assert.deepEqual(textures, Object.keys(art));
});

test('upgrade icons keep an unclipped pixel grid and distinct silhouettes at native size', () => {
  const silhouettes = new Set<string>();
  assert.deepEqual(Object.keys(glyphs).sort(), [...upgradeIds].sort());
  for (const id of upgradeIds) {
    const rows = glyphs[id];
    assert.equal(rows.length, 16, id);
    rows.forEach((row) => {
      assert.equal(row.length, 16, id);
      assert.match(row, /^[.12]+$/, id);
      assert.equal(row[0] + row[15], '..', id + ' needs an edge margin');
    });
    assert.equal(rows[0] + rows[15], '.'.repeat(32), id + ' needs an edge margin');
    const silhouette = rows.join('').replaceAll('2', '1');
    assert.ok(!silhouettes.has(silhouette), id + ' needs its own silhouette');
    silhouettes.add(silhouette);
    assert.ok(glyphPaths[id].shape.length > 0 && glyphPaths[id].light.length > 0, id);
  }
});

test('health bars show continuous proportional health and hide one-hit particles', () => {
  const enemy = target(1, 180, 200, 8, 'dense');
  const original = structuredClone(enemy);
  assert.deepEqual(healthBar(enemy, 2), { width: 15, height: 2, offset: 13, filled: 15 });
  enemy.hp = 4;
  assert.equal(healthBar(enemy, 2)?.filled, 8);
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
  return { graphics, commands };
}
const effect: Effect = {
  kind: 'focus',
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
    const kind = ['multi', 'repeat', 'chain', 'burst', 'repel', 'gather', 'chase', 'orb'].includes(
      id,
    )
      ? 'bolt'
      : id;
    const fx = { ...effect, source: id, kind } as Effect;
    const before = structuredClone(fx);
    for (const scale of [0.65, 1, 1.75]) {
      const active = drawing();
      drawEffect(active.graphics, fx, 1.5, scale, fx.from, []);
      assert.ok(active.commands.length > 0, id + ' must have a visible attack');
      const expired = drawing();
      drawEffect(expired.graphics, fx, 2, scale, fx.from, []);
      assert.equal(expired.commands.length, 0);
      const coincident = drawing();
      drawEffect(coincident.graphics, { ...fx, to: fx.from }, 1.5, scale, fx.from, []);
    }
    assert.deepEqual(fx, before);
  }
});

test('orb bodies render at their current pixel position without changing that position', () => {
  for (const scale of [0.65, 1, 1.75]) {
    const point = { x: 210.4, y: 128.6 },
      before = { ...point };
    const { graphics, commands } = drawing();
    drawOrb(graphics, point, scale);
    const center = commands.at(-1)!;
    assert.equal(center.method, 'fillRect');
    const expected = [
      (Math.round(point.x * scale) - 1) / scale,
      (Math.round(point.y * scale) - 1) / scale,
      2 / scale,
      2 / scale,
    ];
    center.args.forEach((value, i) => close(value, expected[i]));
    assert.deepEqual(point, before);
  }
});

test('focused lightning follows the current electron and tracked particle', () => {
  const enemy = target(7, 160, 210, 100);
  const electron = { x: 40, y: 60 };
  const fx = { ...effect, anchor: 'electron' as const, targetId: enemy.id };
  const before = structuredClone({ fx, enemy, electron });
  {
    const { graphics, commands } = drawing();
    drawEffect(graphics, fx, 1.5, 1, electron, [enemy]);
    assert.ok(
      commands.some(
        ({ method, args }) =>
          method === 'moveTo' && args[0] === electron.x && args[1] === electron.y,
      ),
    );
    assert.ok(
      commands.some(
        ({ method, args }) => method === 'lineTo' && args[0] === enemy.x && args[1] === enemy.y,
      ),
    );
  }
  assert.deepEqual({ fx, enemy, electron }, before);
});

test('lightning stroke widths use whole screen pixels at every viewport scale', () => {
  for (const scale of [0.65, 1, 1.75]) {
    for (const kind of ['bolt', 'strike', 'focus', 'pierce', 'return'] as const) {
      const { graphics, commands } = drawing();
      drawEffect(graphics, { ...effect, kind }, 1.5, scale, effect.from, []);
      const widths = commands
        .filter(({ method }) => method === 'lineStyle')
        .map(({ args }) => args[0] * scale);
      assert.ok(widths.length > 0);
      widths.forEach((width) => assert.ok(Math.abs(width - Math.round(width)) < 1e-8, kind));
    }
  }
});
