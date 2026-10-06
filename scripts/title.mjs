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
    await page.getByRole('button', { name: 'START', exact: true }).waitFor();
    await page.waitForFunction(
      () => window.__gameScene && window.__gameDebug && !document.querySelector('.start').disabled,
    );
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const title = document.querySelector('.arena-caption h1').getBoundingClientRect();
      const start = document.querySelector('.start').getBoundingClientRect();
      const scene = window.__gameScene;
      window.introOriginal = scene.drawIntro.bind(scene);
      window.introClock = 2200;
      scene.drawIntro = (width, height) => {
        const time = scene.time.now;
        scene.time.now = window.introClock;
        try {
          window.introOriginal(width, height);
        } finally {
          scene.time.now = time;
        }
      };
      return {
        title: { left: title.left, right: title.right, bottom: title.bottom },
        start: { top: start.top, left: start.left },
        height: document.documentElement.scrollHeight,
      };
    });
    assert.ok(layout.title.left >= 0 && layout.title.right <= width);
    if (height > width) assert.ok(layout.title.bottom < layout.start.top);
    assert.equal(layout.height, height);
    await capture(page, `artifacts/title-polish/title-${width}.png`);
    await page.evaluate(() => {
      window.introClock = 3920;
    });
    await page.waitForFunction(() =>
      window.__gameScene.sprites.images.some(
        (image) => image.visible && image.texture.key === 'beams',
      ),
    );
    const pulse = await page.evaluate(() => {
      const images = window.__gameScene.sprites.images.filter((image) => image.visible);
      return {
        bolts: images.filter((image) => image.texture.key === 'beams').length,
        body: images.find((image) => image.texture.key === 'electron').displayWidth,
      };
    });
    assert.equal(pulse.bolts, 1);
    assert.equal(pulse.body, 16);
    await capture(page, `artifacts/title-polish/pulse-${width}.png`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(
      () =>
        !window.__gameScene.sprites.images.some(
          (image) => image.visible && image.texture.key === 'beams',
        ),
    );
    const electron = () =>
      page.evaluate(() => {
        const image = window.__gameScene.sprites.images.find(
          (image) => image.visible && image.texture.key === 'electron',
        );
        return { x: image.x, y: image.y };
      });
    const stopped = await electron();
    await page.evaluate(() => {
      window.introClock = 14000;
    });
    await page.waitForTimeout(100);
    assert.deepEqual(await electron(), stopped);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      window.__gameScene.drawIntro = window.introOriginal;
    });
    const started = Date.now();
    const initial = await page.evaluate(() => {
      document.querySelector('.start').click();
      document.querySelector('.start').click();
      const game = window.__gameDebug.getModel();
      return {
        phase: game.phase,
        tick: game.elapsedTicks,
        progress: window.__gameScene.getLaunch(),
      };
    });
    assert.equal(initial.phase, 'ready');
    assert.equal(initial.tick, 0);
    assert.equal(initial.progress, 0);
    await page.waitForFunction(() => window.__gameDebug.getModel().phase === 'running');
    assert.ok(Date.now() - started >= 250);
    assert.equal(
      await page.evaluate(
        () => window.__gameDebug.getModel().events.filter((event) => event.kind === 'start').length,
      ),
      1,
    );
    await page.locator('.hud').waitFor();
    await capture(page, `artifacts/title-polish/started-${width}.png`);
    checks.push({
      viewport: [width, height],
      pulse,
      reducedMotion: true,
      launchOnce: true,
      layout,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/title-polish.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ viewports: checks.length, errors }));
} finally {
  await browser.close();
}
