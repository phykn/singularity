import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, launchBrowser, observeScene, capture } from './browser-support.mjs';

const output = process.argv[2] ?? 'artifacts/electric/after';
const baseline = process.argv.includes('--baseline');
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const errors = [],
  checks = [];
try {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 568, height: 320 },
  ]) {
    const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
    page.on('pageerror', (e) => errors.push(e.message));
    await observeScene(page);
    await page.goto(base);
    await page.waitForFunction(() => window.__gameScene && window.__gameDebug);
    await page.evaluate(() => document.fonts.ready);
    for (const kind of ['orb', 'charge-low', 'charge-high', 'surge', 'return', 'crowd']) {
      const states = [];
      for (const pose of [0, 1, 2]) {
        const state = await page.evaluate(
          async ({ kind, pose }) => {
            const { target } = await import('/tests/helpers.ts');
            const debug = window.__gameDebug;
            debug.restart(421, false);
            const g = debug.getModel();
            g.angle = 0.5;
            g.boosts.speed = 2;
            const origin = g.position;
            const enemy = target(700, origin.x - 70, origin.y - 18, 100000);
            g.targets = [enemy];
            g.counts.quark.generated = 1;
            const advance = (ms) => {
              g.setHidden(false);
              debug.advance(ms);
              g.setHidden(true);
            };
            if (kind === 'orb') {
              g.ranks.orb = 3;
              g.combat.fireSkill('orb');
              advance(350 + pose * 100);
            } else if (kind.startsWith('charge')) {
              g.ranks.charge = 1;
              const hits = kind === 'charge-low' ? 1 : Math.ceil(g.forms.charge.threshold) - 1;
              for (let i = 0; i < hits; i++) g.combat.fireBasic();
              advance(400 + pose * 100);
            } else if (kind === 'surge' || kind === 'crowd') {
              g.ranks.surge = 3;
              for (let i = 0; i < g.forms.surge.kills; i++) {
                const p = target(i, origin.x, origin.y, 1);
                g.targets.push(p);
                g.counts.quark.generated++;
                g.damageTarget(p, 1);
              }
              if (kind === 'crowd') {
                const { orbit } = await import('/src/game/geometry.ts');
                Object.assign(g.ranks, { orb: 5, charge: 5, return: 5 });
                g.targets = Array.from({ length: 240 }, (_, i) => {
                  const p = orbit(i * 2.39996, 50 + ((i * 37) % 115));
                  return {
                    ...target(1000 + i, p.x, p.y, 100000),
                    particle: ['quark', 'muon', 'proton', 'neutron'][i % 4],
                  };
                });
                g.combat.fireSkill('orb');
                g.combat.fireBasic();
              }
              advance(100 + pose * 100);
            } else {
              g.ranks.return = 3;
              g.combat.fireBasic();
              advance(300 + pose * 50);
            }
            g.choice = null;
            debug.advance(0);
            g.setHidden(true);
            const scene = window.__gameScene;
            scene.update();
            const sprites = () =>
              scene.sprites.images
                .filter((s) => s.visible)
                .map((s) => ({
                  key: s.texture.key,
                  frame: Number(s.frame.name),
                  x: s.x,
                  y: s.y,
                  alpha: s.alpha,
                  width: s.displayWidth,
                  height: s.displayHeight,
                  tint: s.tintTopLeft,
                }));
            const visible = sprites(),
              pool = scene.sprites.images.length;
            for (let i = 0; i < 20; i++) scene.update();
            if (JSON.stringify(sprites()) !== JSON.stringify(visible))
              throw Error('Paused visual moved');
            if (pool !== scene.sprites.images.length) throw Error('Sprite pool grew while paused');
            return {
              charge: g.combat.status('charge').progress,
              active: g.combat.status('surge').active,
              point: scene.screen(g.position),
              sprites: visible,
              returnEndpoint: (() => {
                const sprite = scene.sprites.images.find(
                  (s) =>
                    s.visible &&
                    s.texture.key === 'beams' &&
                    Number(s.frame.name) >= 28 &&
                    Number(s.frame.name) < 32,
                );
                return sprite
                  ? {
                      x: sprite.x + (Math.cos(sprite.rotation) * sprite.displayWidth) / 2,
                      y: sprite.y + (Math.sin(sprite.rotation) * sprite.displayWidth) / 2,
                    }
                  : null;
              })(),
              pool,
              targets: g.targets.length,
              kind,
              pose,
            };
          },
          { kind, pose },
        );
        if (!baseline) {
          if (kind === 'return') {
            assert.ok(state.returnEndpoint);
            assert.ok(
              Math.hypot(
                state.returnEndpoint.x - state.point.x,
                state.returnEndpoint.y - state.point.y,
              ) < 1.5,
              'Returning strand must stay connected as the electron moves',
            );
          }
          if (kind.startsWith('charge')) {
            assert.ok(state.charge > 0);
            assert.equal(
              state.sprites.filter((s) => s.key === 'effects' && s.frame >= 12 && s.frame < 16)
                .length,
              1,
              'Stored charge must persist after hit effects expire',
            );
          }
          if (kind === 'surge') {
            assert.ok(state.active);
            assert.ok(
              state.sprites.some((s) => s.key === 'effects' && s.frame >= 16 && s.frame < 20),
            );
            assert.ok(state.sprites.some((s) => s.key === 'electronSurge' && s.width === 16));
          }
        }
        await capture(page, `${output}/${kind}-${viewport.width}-${pose}.png`);
        states.push(state);
      }
      if (!baseline && kind === 'orb')
        assert.ok(
          new Set(
            states.map(
              (s) =>
                s.sprites.find((p) => p.key === 'effects' && p.frame >= 8 && p.frame < 12)?.frame,
            ),
          ).size > 1,
        );
      checks.push({ viewport, kind, states });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ scenes: checks.length, poses: checks.length * 3, errors }));
} finally {
  await browser.close();
}
