import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { base, capture, launchBrowser } from './browser-support.mjs';
import { copy } from '../src/ui/i18n.ts';

const browser = await launchBrowser();
const checks = [],
  errors = [];
try {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 568, height: 320 },
    { width: 812, height: 375 },
  ]) {
    const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    for (const rank of [1, 10, 100]) {
      const stats = await page.evaluate((rank) => {
        const debug = window.__gameDebug;
        debug.restart(42, false);
        const g = debug.getModel();
        g.setHidden(true);
        g.xp = g.rules.energyGoal - 1;
        Object.assign(g.boosts, { power: rank, rate: rank, range: rank, speed: rank });
        debug.advance(0);
        return { damage: g.damage, rate: g.rate, range: g.range, speed: g.speed };
      }, rank);
      const expected = String(Number(stats.rate.toFixed(2))) + '\u00d7';
      await page.waitForFunction(
        (value) => document.querySelectorAll('.boost b')[1]?.textContent === value,
        expected,
      );
      const values = await page.locator('.boost b').allTextContents();
      if (rank === 1) {
        assert.deepEqual(values, [
          String(Math.round(stats.damage)),
          expected,
          String(Math.round(stats.range)),
          String(Math.round(stats.speed)),
        ]);
      }
      const bounds = await page.evaluate(() => {
        const hud = document.querySelector('.hud').getBoundingClientRect();
        return [...document.querySelectorAll('.hud-top > *')].map((node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left - hud.left, right: r.right - hud.left, width: hud.width };
        });
      });
      bounds.forEach((r, i) => {
        assert.ok(
          r.left >= -0.1 && r.right <= r.width + 0.1,
          `HUD overflow ${viewport.width}, rank ${rank}`,
        );
        if (i) assert.ok(bounds[i - 1].right <= r.left + 0.1, 'HUD groups must not overlap');
      });
      checks.push({ viewport, rank, values });
    }
    await capture(page, `artifacts/controls/hud-${viewport.width}.png`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('singularity.language', JSON.stringify('en')),
  );
  await page.goto(base);
  const c = copy.en;
  const paused = () => page.evaluate(() => window.__gameDebug.getModel().manualPaused);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__gameDebug.getModel().phase), 'ready');
  for (const name of [c.guide, c.settings]) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
  }
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.evaluate(() => {
    window.__gameDebug.restart(42, false);
    window.__gameDebug.getModel().nextSpawn = Infinity;
  });
  await page.keyboard.press('Escape');
  assert.equal(await paused(), true);
  const frozen = await page.evaluate(() => window.__gameDebug.getModel().tick);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__gameDebug.getModel().tick), frozen);
  await page.getByRole('button', { name: c.guide, exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await paused(), true);
  assert.equal(await page.locator('.pause-panel').count(), 1);
  await page.getByRole('button', { name: c.quit, exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await paused(), true);
  assert.equal(await page.locator('#pause-title').textContent(), c.pause);
  await page.keyboard.press('Escape');
  assert.equal(await paused(), false);
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => window.__gameDebug.getModel().tick)) > frozen);
  await page.keyboard.down('Escape');
  assert.equal(await paused(), true);
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true }),
    ),
  );
  assert.equal(await paused(), true);
  await page.keyboard.up('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await paused(), false);
  await page.evaluate(() => window.__gameDebug.xp(100));
  await page.locator('.choice-pause').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  const choice = await page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    return { tick: g.tick, remaining: g.choice.deadline - g.time };
  });
  await page.waitForTimeout(250);
  assert.deepEqual(
    await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      return { tick: g.tick, remaining: g.choice.deadline - g.time };
    }),
    choice,
  );
  await page.keyboard.press('Escape');
  assert.equal(await paused(), false);
  checks.push({
    keyboard:
      'Escape closes panels, cancels quit, pauses and resumes without consuming choices; held key ignored',
  });
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/controls.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ hudCases: 15, keyboard: true, errors }));
} finally {
  await browser.close();
}
