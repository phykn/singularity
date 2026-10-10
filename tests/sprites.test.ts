import test from 'node:test';
import assert from 'node:assert/strict';
import type Phaser from 'phaser';
import { SpritePool } from '../src/render/SpritePool.ts';
import { EffectRenderer } from '../src/render/EffectRenderer.ts';
import type { Game } from '../src/game/Game.ts';

function pool() {
  let visibilityChanges = 0;
  const add = {
    graphics() {
      const graphics = new Proxy({}, { get: () => () => graphics });
      return graphics;
    },
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
        tintTopLeft: 0xffffff,
        textureChanges: 0,
        setTexture(key: string, frame = 0) {
          this.textureChanges++;
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
        clearTint() {
          this.tintTopLeft = 0xffffff;
          return this;
        },
        setTint(color: number) {
          this.tintTopLeft = color;
          return this;
        },
      };
    },
  };
  return {
    sprites: new SpritePool(add as unknown as Phaser.GameObjects.GameObjectFactory),
    add: add as unknown as Phaser.GameObjects.GameObjectFactory,
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

test('particle entry and exit cannot move or retexture pooled attack images', () => {
  const { sprites, add } = pool();
  const effects = new EffectRenderer(add, (point) => ({
    x: 12 + point.x * 0.75,
    y: 8 + point.y * 0.75,
  }));
  const game = {
    position: { x: 20, y: 30 },
    radius: 100,
    seconds: 1.05,
    targets: [],
    ranks: { charge: 0, surge: 0 },
    combat: { status: () => ({ active: false, progress: 0 }) },
    effects: [
      {
        kind: 'bolt',
        from: { x: 0, y: 0 },
        to: { x: 100, y: 60 },
        anchor: 'electron',
        born: 1,
        life: 0.2,
        damage: 13,
        rank: 5,
        rarity: 'common',
        radius: 0,
        width: 1,
      },
    ],
  } as unknown as Game;
  const frame = (count: number) => {
    sprites.begin();
    effects.begin();
    for (let i = 0; i < count; i++) sprites.draw({ x: i, y: i }, 'quark');
    effects.draw(game, 0.75, []);
    sprites.draw(game.position, 'electron', 1, 1, 2);
    sprites.end();
    effects.end();
  };
  frame(3);
  const attacks = [...effects.sprites.images];
  const before = attacks.map((image) => ({
    image,
    key: image.texture.key,
    frame: image.frame.name,
    x: image.x,
    y: image.y,
    textureChanges: (image as unknown as { textureChanges: number }).textureChanges,
  }));
  for (const count of [0, 8, 1, 3]) frame(count);
  assert.equal(effects.sprites.images.length, attacks.length);
  effects.sprites.images.forEach((image, i) => assert.equal(image, attacks[i]));
  for (const state of before) {
    assert.equal(state.image.texture.key, state.key);
    assert.equal(state.image.frame.name, state.frame);
    assert.equal(state.image.x, state.x);
    assert.equal(state.image.y, state.y);
    assert.equal(
      (state.image as unknown as { textureChanges: number }).textureChanges,
      state.textureChanges,
    );
    assert.ok(!sprites.images.includes(state.image));
  }
  assert.deepEqual(
    attacks.map((image) => image.texture.key),
    ['beams', 'effects'],
  );
  assert.equal(Number(attacks[0].frame.name), 32);
  assert.deepEqual(
    attacks.map((image) => image.depth),
    [1, 1.5],
  );
  game.effects = [];
  frame(0);
  assert.ok(attacks.every((image) => !image.visible && !image.active));
  assert.equal(effects.sprites.images.length, 2);
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
