import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { base, launchBrowser, observeScene, capture } from './browser-support.mjs';

const browser = await launchBrowser();
const checks = [],
  errors = [];
try {
  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [568, 320],
    [1024, 768],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: width < 600,
      hasTouch: true,
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await observeScene(page);
    await page.goto(base);
    await page.waitForFunction(
      () => window.__gameScene && window.__gameDebug && !document.querySelector('.start')?.disabled,
    );
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const title = document.querySelector('.arena-caption h1').getBoundingClientRect();
      const start = document.querySelector('.start').getBoundingClientRect();
      const meta = document.querySelector('.title-meta').getBoundingClientRect();
      return {
        title: { left: title.left, right: title.right, bottom: title.bottom },
        start: { top: start.top },
        height: document.documentElement.scrollHeight,
        meta: { left: meta.left, right: meta.right, top: meta.top },
      };
    });
    assert.ok(layout.title.left >= 0 && layout.title.right <= width);
    if (height > width) assert.ok(layout.title.bottom <= layout.start.top);
    assert.equal(layout.height, height);
    assert.ok(layout.title.bottom <= layout.meta.top || layout.title.right <= layout.meta.left);
    const idle = await page.evaluate(() => ({
      angle: window.__gameDebug.getModel().angle,
      tick: window.__gameDebug.getModel().elapsedTicks,
      targets: window.__gameDebug.getModel().targets.length,
    }));
    await page.waitForTimeout(150);
    const later = await page.evaluate(() => ({
      angle: window.__gameDebug.getModel().angle,
      tick: window.__gameDebug.getModel().elapsedTicks,
      targets: window.__gameDebug.getModel().targets.length,
    }));
    assert.ok(later.angle > idle.angle);
    assert.equal(later.tick, 0);
    assert.equal(later.targets, 0);
    await capture(page, `artifacts/title-polish/title-${width}.png`);
    for (const [i, wait] of [0, 300, 900].entries()) {
      if (i > 0) await page.evaluate(() => window.__gameDebug.prepare(10004));
      await page.getByRole('button', { name: 'START', exact: true }).waitFor();
      await page.waitForTimeout(wait);
      await page.emulateMedia({ reducedMotion: i === 2 ? 'reduce' : 'no-preference' });
      const seam = await page.evaluate(async () => {
        const scene = window.__gameScene,
          game = window.__gameDebug.getModel();
        const pose = () => {
          scene.update();
          const image = scene.sprites.images.find(
            (image) => image.visible && image.texture.key === 'electron',
          );
          const r = scene.game.canvas.getBoundingClientRect();
          return {
            x: r.left + image.x,
            y: r.top + image.y,
            alpha: image.alpha,
            size: image.displayWidth,
            angle: game.angle,
            radius: game.radius * scene.worldScale,
            rect: [r.left, r.top, r.width, r.height],
          };
        };
        const before = pose(),
          start = document.querySelector('.start');
        start.click();
        start.click();
        game.setHidden(true);
        const immediate = pose();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const after = pose();
        return {
          before,
          immediate,
          after,
          phase: game.phase,
          tick: game.elapsedTicks,
          targets: game.targets.length,
          starts: game.events.filter((event) => event.kind === 'start').length,
        };
      });
      assert.equal(seam.phase, 'running');
      assert.equal(seam.tick, 0);
      assert.ok(seam.targets > 0);
      assert.equal(seam.starts, 1);
      for (const pose of [seam.immediate, seam.after]) {
        assert.equal(pose.angle, seam.before.angle);
        assert.equal(pose.radius, seam.before.radius);
        assert.deepEqual(pose.rect, seam.before.rect);
        assert.ok(Math.hypot(pose.x - seam.before.x, pose.y - seam.before.y) <= 1);
        assert.equal(pose.alpha, 1);
        assert.equal(pose.size, 16);
      }
      checks.push({ viewport: [width, height], wait, reducedMotion: i === 2, layout, seam });
    }
    await page.locator('.hud').waitFor();
    await capture(page, `artifacts/title-polish/started-${width}.png`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/title-polish.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ viewports: 4, starts: checks.length, errors }));
} finally {
  await browser.close();
}
