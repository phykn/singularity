import test from 'node:test';
import assert from 'node:assert/strict';
import type Phaser from 'phaser';
import { art, createPixels, palettes } from '../src/render/pixels.ts';
import { healthBar } from '../src/render/health.ts';
import { drawEffect } from '../src/render/lightning.ts';
import type { Effect } from '../src/game/types.ts';
import { skillIds } from '../src/game/rules.ts';
import { target } from './helpers.ts';

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
    const kind = ['multi', 'repeat', 'chain', 'burst'].includes(id) ? 'bolt' : id;
    const fx = { ...effect, source: id, kind } as Effect;
    const before = structuredClone(fx);
    for (const scale of [0.65, 1, 1.75])
      for (const reduced of [false, true]) {
        const active = drawing();
        drawEffect(active.graphics, fx, 1.5, scale, reduced, fx.from, []);
        assert.ok(active.commands.length > 0, id + ' must have a visible attack');
        const expired = drawing();
        drawEffect(expired.graphics, fx, 2, scale, reduced, fx.from, []);
        assert.equal(expired.commands.length, 0);
        const coincident = drawing();
        drawEffect(coincident.graphics, { ...fx, to: fx.from }, 1.5, scale, reduced, fx.from, []);
      }
    assert.deepEqual(fx, before);
  }
});

test('focused lightning follows the current electron and tracked particle', () => {
  const enemy = target(7, 160, 210, 100);
  const electron = { x: 40, y: 60 };
  const fx = { ...effect, anchor: 'electron' as const, targetId: enemy.id };
  const before = structuredClone({ fx, enemy, electron });
  for (const reduced of [false, true]) {
    const { graphics, commands } = drawing();
    drawEffect(graphics, fx, 1.5, 1, reduced, electron, [enemy]);
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

test('splash shows its fixed hit radius while the wave front expands', () => {
  for (const progress of [0.25, 0.75]) {
    const area = drawing(),
      wave = drawing();
    drawEffect(
      area.graphics,
      { ...effect, kind: 'area', source: 'area' },
      1 + progress,
      1,
      true,
      effect.from,
      [],
    );
    drawEffect(
      wave.graphics,
      { ...effect, kind: 'wave', source: 'wave' },
      1 + progress,
      1,
      true,
      effect.from,
      [],
    );
    assert.ok(
      area.commands.some(
        ({ method, args }) => method === 'fillCircle' && args[2] === effect.radius,
      ),
    );
    assert.ok(
      wave.commands.some(
        ({ method, args }) => method === 'strokeCircle' && args[2] === effect.radius * progress,
      ),
    );
  }
});
