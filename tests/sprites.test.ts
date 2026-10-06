import test from 'node:test';
import assert from 'node:assert/strict';
import type Phaser from 'phaser';
import { SpritePool } from '../src/render/SpritePool.ts';

function pool() {
  let visibilityChanges = 0;
  const add = {
    image(x: number, y: number, key: string) {
      return {
        x,
        y,
        texture: { key },
        frame: { name: 0 },
        active: true,
        visible: true,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        depth: 0,
        rotation: 0,
        setTexture(key: string, frame = 0) {
          this.texture.key = key;
          this.frame.name = frame;
          return this;
        },
        setPosition(x: number, y: number) {
          this.x = x;
          this.y = y;
          return this;
        },
        setScale(x: number, y: number) {
          this.scaleX = x;
          this.scaleY = y;
          return this;
        },
        setAlpha(alpha: number) {
          this.alpha = alpha;
          return this;
        },
        setDepth(depth: number) {
          this.depth = depth;
          return this;
        },
        setRotation(rotation: number) {
          this.rotation = rotation;
          return this;
        },
        setActive(active: boolean) {
          this.active = active;
          return this;
        },
        setVisible(visible: boolean) {
          visibilityChanges++;
          this.visible = visible;
          return this;
        },
      };
    },
  };
  return {
    sprites: new SpritePool(add as unknown as Phaser.GameObjects.GameObjectFactory),
    changes: () => visibilityChanges,
  };
}

test('sprite frames reuse visible images, retire unused ones, and resume without growing the pool', () => {
  const { sprites, changes } = pool();
  for (let frame = 0; frame < 10; frame++) {
    sprites.begin();
    sprites.draw({ x: 10, y: 20 }, 'quark');
    sprites.draw({ x: 30, y: 40 }, 'muon');
    sprites.end();
  }
  assert.equal(sprites.images.length, 2);
  assert.equal(changes(), 0, 'Stable frames must not hide and show every image');
  sprites.begin();
  sprites.draw({ x: 10, y: 20 }, 'electron');
  sprites.end();
  assert.deepEqual(
    sprites.images.map((image) => image.visible),
    [true, false],
  );
  sprites.begin();
  sprites.draw({ x: 10, y: 20 }, 'quark');
  sprites.draw({ x: 30, y: 40 }, 'muon');
  sprites.end();
  assert.equal(sprites.images.length, 2);
  assert.ok(sprites.images.every((image) => image.visible && image.active));
  sprites.begin();
  sprites.end();
  assert.ok(sprites.images.every((image) => !image.visible && !image.active));
});

test('reusing a lightning image restores native particle geometry and depth', () => {
  const { sprites } = pool();
  sprites.begin();
  const beam = sprites.draw({ x: 50, y: 60 }, 'beams', 3, 0.4, 1, 17, Math.PI / 3, 0.5);
  sprites.end();
  sprites.begin();
  const particle = sprites.draw({ x: 20.3, y: 30.8 }, 'electron', 1, 1, 2);
  sprites.end();
  assert.equal(particle, beam);
  assert.equal(particle.texture.key, 'electron');
  assert.deepEqual(
    [
      particle.x,
      particle.y,
      particle.scaleX,
      particle.scaleY,
      particle.rotation,
      particle.alpha,
      particle.depth,
    ],
    [20, 31, 1, 1, 0, 1, 2],
  );
});
