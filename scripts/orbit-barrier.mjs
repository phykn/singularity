import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, launchBrowser, observeScene, capture } from './browser-support.mjs';

const output = process.argv[2] ?? 'artifacts/orbit-barrier';
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const errors = [],
  checks = [];
try {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 568, height: 320 },
  ]) {
    const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
    page.on('pageerror', (e) => errors.push(e.message));
    await observeScene(page);
    await page.goto(base);
    await page.waitForFunction(() => window.__gameScene && window.__gameDebug);
    await page.evaluate(() => document.fonts.ready);
    for (const rank of [1, 3, 5]) {
      const state = await page.evaluate(async (rank) => {
        const { target } = await import('/tests/helpers.ts');
        const { orbit, CENTER } = await import('/src/game/geometry.ts');
        const { visibleEffects } = await import('/src/render/effects.ts');
        const debug = window.__gameDebug;
        debug.restart(421, false);
        const g = debug.getModel();
        g.angle = -2.4;
        Object.assign(g.ranks, { bridge: rank, repeat: 2, chain: 2, charge: 2 });
        g.rarities.bridge = 'rare';
        g.targets = Array.from({ length: rank === 5 ? 240 : 32 }, (_, i) => {
          const p = orbit(i * 2.39996, 70 + ((i * 37) % 115));
          return {
            ...target(i, p.x, p.y, 10000),
            particle: ['quark', 'muon', 'proton', 'neutron'][i % 4],
          };
        });
        const advance = (ms) => {
          g.setHidden(false);
          debug.advance(ms);
          g.setHidden(true);
        };
        g.combat.fireSkill('bridge');
        advance(900);
        g.combat.fireSkill('bridge');
        advance(650);
        const scene = window.__gameScene;
        const sprites = () =>
          scene.sprites.images
            .filter((s) => s.visible)
            .map((s) => ({
              key: s.texture.key,
              frame: Number(s.frame.name),
              x: s.x,
              y: s.y,
              angle: s.rotation,
              width: s.displayWidth,
              height: s.displayHeight,
              alpha: s.alpha,
            }));
        scene.update();
        const first = sprites(),
          pool = scene.sprites.images.length;
        for (let i = 0; i < 60; i++) scene.update();
        if (JSON.stringify(first) !== JSON.stringify(sprites()))
          throw Error('Paused barrier moved');
        if (pool !== scene.sprites.images.length) throw Error('Paused sprite pool grew');
        const arcs = visibleEffects(g.effects).filter((fx) => fx.kind === 'bridge');
        // The radius can change between effect refreshes; geometry must use the live orbit.
        g.radius -= 20;
        scene.update();
        const center = scene.screen(CENTER);
        const edge = scene.screen(orbit(0, g.radius));
        const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
        const beams = sprites().filter(
          (s) => s.key === 'beams' && s.frame % 32 >= 24 && s.frame % 32 < 28,
        );
        for (const beam of beams) {
          for (const side of [-1, 1]) {
            const x = beam.x + (side * Math.cos(beam.angle) * beam.width) / 2;
            const y = beam.y + (side * Math.sin(beam.angle) * beam.width) / 2;
            if (Math.abs(Math.hypot(x - center.x, y - center.y) - radius) > 1.6)
              throw Error('Barrier slipped off the live orbit');
          }
        }
        return {
          rank,
          arcs: arcs.length,
          sweep: arcs.reduce((s, fx) => s + fx.arc.sweep, 0),
          beams: beams.length,
          pool,
          targets: g.targets.length,
          errors: [],
        };
      }, rank);
      assert.equal(state.arcs, 2);
      assert.ok(state.sweep < Math.PI);
      assert.ok(state.beams > 0 && state.beams <= 20);
      await capture(page, `${output}/rank-${rank}-${viewport.width}.png`);
      checks.push({ viewport, ...state });
    }
    await page.evaluate(() => {
      const debug = window.__gameDebug,
        g = debug.getModel();
      g.ranks.bridge = 2;
      g.ranks.repeat = 0;
      g.ranks.chain = 0;
      g.ranks.charge = 0;
      g.choice = {
        number: 1,
        opened: g.time,
        deadline: g.time + 10,
        cards: [
          { id: 'bridge', rarity: 'rare' },
          { id: 'satellite', rarity: 'epic' },
          { id: 'vent', rarity: 'common' },
        ],
      };
      debug.advance(0);
      g.setHidden(true);
    });
    await page.locator('.choices').evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished));
    });
    await capture(page, `${output}/choice-${viewport.width}.png`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ scenes: checks.length, errors, checks }));
} finally {
  await browser.close();
}
