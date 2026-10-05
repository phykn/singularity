import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, capture, launchBrowser } from './browser-support.mjs';

mkdirSync('artifacts/screens', { recursive: true });
const browser = await launchBrowser();
const checks = [],
  errors = [];
const state = (page) =>
  page.evaluate(() => {
    const game = window.__gameDebug.getModel();
    return {
      tick: game.tick,
      elapsed: game.elapsedTicks,
      choice: game.choice,
      paused: game.manualPaused,
    };
  });
const screenshotWhileLoading = async (page, path) => {
  // Playwright normally waits for fonts, which this test intentionally holds.
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
  try {
    await capture(page, path);
  } finally {
    delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
  }
};
const report = (task, details) => {
  checks.push({ task, details });
  console.log('PASS ' + task, JSON.stringify(details));
};
try {
  const page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  let release;
  let held = new Promise((resolve) => (release = resolve));
  await page.route('**/fonts/latin.woff2', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__gameDebug);
  assert.equal(await page.locator('.start').isDisabled(), true);
  await page.waitForTimeout(900);
  assert.equal((await state(page)).elapsed, 0);
  assert.equal(await page.locator('canvas').count(), 0);
  await screenshotWhileLoading(page, 'artifacts/screens/startup-loading.png');
  release();
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.locator('.hud').waitFor();
  assert.equal(await page.locator('canvas').count(), 1);
  report('slow font loading holds START until the first rendered frame', { elapsedBeforeReady: 0 });
  const expected = await page.evaluate(() => {
    const debug = window.__gameDebug;
    for (let i = 0; i < 120 && !debug.getModel().choice; i++) debug.advance(250);
    const game = debug.getModel();
    game.setHidden(true);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return { seed: game.seed, elapsed: game.elapsedTicks, choice: game.choice };
  });
  assert.ok(expected.choice);
  held = new Promise((resolve) => (release = resolve));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__gameDebug);
  assert.equal(await page.locator('.start').isDisabled(), true);
  await page.waitForTimeout(900);
  const loading = await state(page);
  assert.equal(loading.elapsed, 0);
  assert.equal(loading.choice, null);
  assert.equal(loading.paused, false);
  assert.notEqual(await page.evaluate(() => window.__gameDebug.getModel().seed), expected.seed);
  await screenshotWhileLoading(page, 'artifacts/screens/startup-refreshed-loading.png');
  release();
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.locator('.hud').waitFor();
  report('refresh starts a new seed and stays ready while the scene loads', { elapsed: 0 });
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    window.lostContext = gl.getExtension('WEBGL_lose_context');
    window.lostContext.loseContext();
  });
  await page.locator('.render-status').waitFor();
  const lost = await state(page);
  await page.waitForTimeout(900);
  assert.deepEqual(await state(page), lost);
  await capture(page, 'artifacts/screens/context-lost.png');
  await page.evaluate(() => window.lostContext.restoreContext());
  await page.locator('.render-status').waitFor({ state: 'hidden' });
  await page.waitForFunction((tick) => window.__gameDebug.getModel().tick > tick, lost.tick);
  await capture(page, 'artifacts/screens/context-restored.png');
  report('lost graphics context freezes combat and deadlines until a rendered recovery', {
    tick: lost.tick,
  });
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const paused = await state(page);
  await page.evaluate(() => window.lostContext.loseContext());
  await page.locator('.render-status').waitFor();
  await page.evaluate(() => window.lostContext.restoreContext());
  await page.locator('.render-status').waitFor({ state: 'hidden' });
  await page.waitForTimeout(500);
  assert.deepEqual(await state(page), paused);
  await page.getByRole('button', { name: '계속하기', exact: true }).click();
  await page.waitForFunction((tick) => window.__gameDebug.getModel().tick > tick, paused.tick);
  report('graphics recovery preserves a manual pause', { tick: paused.tick });
  await page.close();

  const failed = await browser.newPage({ viewport: { width: 375, height: 812 } });
  failed.on('pageerror', (error) => errors.push(error.message));
  await failed.route('**/fonts/latin.woff2', (route) => route.abort());
  await failed.goto(base + '/?seed=10004');
  await failed.getByRole('button', { name: 'START', exact: true }).click();
  await failed.locator('.hud').waitFor();
  assert.equal(await failed.locator('canvas').count(), 1);
  await failed.waitForFunction(() => window.__gameDebug.getModel().tick > 0);
  await capture(failed, 'artifacts/screens/startup-font-failed.png');
  report('a failed font request still renders and starts with the existing fallback', {
    canvas: true,
  });
  await failed.close();
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/startup.json', JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
