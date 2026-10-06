import test from 'node:test';
import assert from 'node:assert/strict';
import type Phaser from 'phaser';
import { readFileSync } from 'node:fs';
import { beamFrame, beamPose, beamRows, effectFrame, effectRows } from '../src/render/effects.ts';
import { particleArt, particlePalettes } from '../src/art/particles.ts';
import { createParticleTextures } from '../src/render/particleTextures.ts';
import { healthBar } from '../src/render/healthBars.ts';
import { drawEffect } from '../src/render/drawEffects.ts';
import type { Effect } from '../src/game/types.ts';
import { skillIds, upgradeIds } from '../src/game/rules.ts';
import { iconCells } from '../src/art/skills.ts';
import { close, target } from './helpers.ts';
import { drawWaveWarning, WARNING_RED } from '../src/render/warning.ts';

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
  for (const [path, width, height] of [['../src/art/assets/skills.png', 224, 96]] as const) {
    const png = readFileSync(new URL(path, import.meta.url));
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.equal(png[25], 6, 'PNG must preserve alpha');
  }
});

test('health bars show continuous proportional health and hide one-hit particles', () => {
  const enemy = target(1, 180, 200, 8, 'dense');
  const original = structuredClone(enemy);
  assert.deepEqual(healthBar(enemy, 2), { width: 16, height: 2, offset: 13, filled: 16 });
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
  return {
    graphics,
    commands,
    beam: (
      id: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
      progress: number,
      color: number,
      alpha: number,
      height: number,
    ) => {
      const args = [from.x, from.y, to.x, to.y, progress, color, alpha, height];
      assert.ok(args.every(Number.isFinite), id + ' received invalid beam geometry');
      commands.push({ method: 'beam:' + id, args });
    },
    stamp: (
      id: string,
      point: { x: number; y: number },
      progress: number,
      color: number,
      alpha: number,
    ) => {
      commands.push({ method: 'stamp:' + id, args: [point.x, point.y, progress, color, alpha] });
    },
  };
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
      drawEffect(active.graphics, fx, 1.5, scale, fx.from, [], active.stamp, active.beam);
      assert.ok(active.commands.length > 0, id + ' must have a visible attack');
      const expired = drawing();
      drawEffect(expired.graphics, fx, 2, scale, fx.from, [], expired.stamp, expired.beam);
      assert.equal(expired.commands.length, 0);
      const coincident = drawing();
      drawEffect(
        coincident.graphics,
        { ...fx, to: fx.from },
        1.5,
        scale,
        fx.from,
        [],
        coincident.stamp,
        coincident.beam,
      );
    }
    assert.deepEqual(fx, before);
  }
});

test('generated effect frames stay inside their row, loop only sustained effects and freeze with combat time', () => {
  const png = readFileSync(new URL('../src/art/assets/effects.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 192);
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
  for (const [id, period] of [
    ['orb', 0.4],
    ['charge', 0.5],
    ['surge', 0.4],
  ] as const)
    assert.equal(effectFrame(id, period), effectFrame(id, 0));
});

test('focused lightning follows the current electron and tracked particle', () => {
  const enemy = target(7, 160, 210, 100);
  const electron = { x: 40, y: 60 };
  const fx = { ...effect, anchor: 'electron' as const, targetId: enemy.id };
  const before = structuredClone({ fx, enemy, electron });
  {
    const { graphics, commands, stamp, beam } = drawing();
    drawEffect(graphics, fx, 1.5, 1, electron, [enemy], stamp, beam);
    const focused = commands.find(({ method }) => method === 'beam:focus');
    assert.ok(focused);
    assert.deepEqual(focused.args.slice(0, 4), [electron.x, electron.y, enemy.x, enemy.y]);
  }
  assert.deepEqual({ fx, enemy, electron }, before);
});

test('lightning beam heights use whole screen pixels at every viewport scale', () => {
  for (const scale of [0.65, 1, 1.75]) {
    for (const kind of ['bolt', 'strike', 'focus', 'pierce', 'return'] as const) {
      const { graphics, commands, stamp, beam } = drawing();
      drawEffect(graphics, { ...effect, kind }, 1.5, scale, effect.from, [], stamp, beam);
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
  assert.equal(png.readUInt32BE(20), 128);
  assert.equal(png[25], 6);
  for (const id of Object.keys(beamRows) as (keyof typeof beamRows)[]) {
    for (const time of [-1, 0, 0.1, 0.7, 3, 30]) {
      const frame = beamFrame(id, time);
      assert.ok(frame >= beamRows[id] * 4 && frame < beamRows[id] * 4 + 4);
      assert.equal(beamFrame(id, time), frame);
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
