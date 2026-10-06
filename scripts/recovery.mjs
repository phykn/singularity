import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { base, launchBrowser, observeScene, capture } from './browser-support.mjs';
const browser = await launchBrowser();
const checks = [],
  errors = [];
try {
  for (const [width, height] of [
    [375, 812],
    [568, 320],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await observeScene(page);
    await page.goto(base);
    await page.waitForFunction(
      () => window.__gameDebug && window.__gameScene && !document.querySelector('.start')?.disabled,
    );
    const before = await page.evaluate(() => {
      const debug = window.__gameDebug;
      debug.restart(42, false);
      const g = debug.getModel();
      g.mass = 150;
      g.radius = 100;
      debug.advance(1000);
      debug.xp(14);
      g.choice.cards = [{ id: 'recover', rarity: 'common' }];
      debug.advance(0);
      return { mass: g.mass, radius: g.radius, xp: g.xp, speed: g.speed };
    });
    await page.locator('.card[data-upgrade="recover"]').waitFor();
    await page.evaluate(() =>
      window.addEventListener('click', () => window.__gameDebug.getModel().setHidden(true), {
        once: true,
      }),
    );
    await page.locator('.card[data-upgrade="recover"]').tap();
    const selected = await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      return {
        mass: g.mass,
        radius: g.radius,
        target: g.targetRadius,
        selections: g.selections.length,
      };
    });
    assert.equal(selected.mass, 100);
    assert.equal(selected.radius, before.radius, 'Selecting recovery never teleports the electron');
    assert.ok(selected.target < selected.radius, 'Reproduce the still-shrinking gravity target');
    assert.equal(selected.selections, 1);
    const recovered = await page.evaluate(() => {
      const debug = window.__gameDebug,
        g = debug.getModel(),
        scene = window.__gameScene;
      g.setHidden(false);
      debug.advance(1000);
      g.setHidden(true);
      const original = scene.graphics.strokeCircle;
      let orbit;
      scene.graphics.strokeCircle = function (x, y, radius, ...args) {
        if (orbit === undefined) orbit = radius;
        return original.call(this, x, y, radius, ...args);
      };
      try {
        scene.update();
      } finally {
        scene.graphics.strokeCircle = original;
      }
      return { mass: g.mass, radius: g.radius, orbit, xp: g.xp, speed: g.speed, phase: g.phase };
    });
    assert.ok(Math.abs(recovered.radius - before.radius - 6) < 1e-7);
    assert.equal(
      recovered.orbit,
      recovered.radius,
      'The displayed orbit follows the recovered radius',
    );
    assert.equal(recovered.mass, 100);
    assert.equal(recovered.xp, before.xp);
    assert.equal(recovered.speed, before.speed);
    assert.equal(recovered.phase, 'running');
    await capture(page, `artifacts/recovery/${width}.png`);
    checks.push({ width, height, before, selected, recovered });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/recovery/browser.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ viewports: checks.length, errors }));
} finally {
  await browser.close();
}
