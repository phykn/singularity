import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { base, capture, launchBrowser } from './browser-support.mjs';
import { copy, languages } from '../src/ui/i18n.ts';
import { languageKey } from '../src/app/storage.ts';

const browser = await launchBrowser();
const checks = [],
  errors = [];
const snapshot = (page) =>
  page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    return {
      tick: g.tick,
      remaining: g.choice ? g.choice.deadline - g.time : null,
      angle: g.angle,
      targets: g.targets,
      effects: g.effects,
      selections: g.selections.length,
    };
  });
try {
  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [430, 932],
    [568, 320],
    [812, 375],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await page.evaluate(() => window.__gameDebug.xp(14));
    const toggle = page.getByRole('switch', { name: copy.ko.choicePause });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    assert.equal(await toggle.innerText(), '');
    const layout = await toggle.evaluate((node) => {
      const r = node.getBoundingClientRect(),
        card = document.querySelector('.card').getBoundingClientRect();
      const countdown = node.previousElementSibling.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        cardTop: card.top,
        countdownRight: countdown.right,
        scroll: document.documentElement.scrollHeight,
        viewport: innerHeight,
      };
    });
    assert.ok(layout.w >= 44 && layout.h >= 44);
    assert.ok(
      layout.x >= 0 &&
        layout.y >= 0 &&
        layout.x + layout.w <= width &&
        layout.y + layout.h <= layout.cardTop,
    );
    assert.ok(layout.countdownRight <= layout.x);
    assert.equal(layout.scroll, layout.viewport);
    const frozen = await snapshot(page);
    await page.waitForTimeout(450);
    const stopped = await snapshot(page);
    assert.equal(stopped.tick, frozen.tick);
    assert.equal(stopped.angle, frozen.angle);
    assert.deepEqual(stopped.targets, frozen.targets);
    assert.ok(stopped.remaining < frozen.remaining - 0.3);
    await capture(page, `artifacts/screens/choice-stop-${width}x${height}.png`);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await page.waitForFunction((tick) => window.__gameDebug.getModel().tick > tick, frozen.tick);
    const running = await snapshot(page);
    assert.ok(running.remaining < stopped.remaining);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    const pausedAgain = await snapshot(page);
    await page.waitForTimeout(150);
    assert.equal((await snapshot(page)).tick, pausedAgain.tick);
    await capture(page, `artifacts/screens/choice-toggle-${width}x${height}.png`);
    await page.locator('.card').first().click();
    await page.waitForFunction(
      (n) => window.__gameDebug.getModel().selections.length > n,
      frozen.selections,
    );
    await page.waitForFunction(
      (tick) => window.__gameDebug.getModel().tick > tick,
      pausedAgain.tick,
    );
    await page.evaluate(() => {
      window.__gameDebug.restart(42, false);
      window.__gameDebug.xp(14);
    });
    await toggle.waitFor();
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await page.evaluate(() => {
      window.__gameDebug.restart(43, false);
      window.__gameDebug.xp(14);
    });
    await page.waitForFunction(
      () => document.querySelector('.choice-pause')?.getAttribute('aria-checked') === 'true',
    );
    await toggle.click();
    await page.reload();
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await page.evaluate(() => window.__gameDebug.xp(14));
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    checks.push({
      viewport: [width, height],
      iconOnly: true,
      touchTarget: [layout.w, layout.h],
      resets: true,
    });
    console.log('PASS choice pause toggle', JSON.stringify(checks.at(-1)));
    await page.close();
  }
  for (const language of languages) {
    const page = await browser.newPage({
      viewport: { width: 320, height: 568 },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(({ key, id }) => localStorage.setItem(key, JSON.stringify(id)), {
      key: languageKey,
      id: language.id,
    });
    await page.goto(base);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await page.evaluate(() => window.__gameDebug.xp(14));
    const toggle = page.getByRole('switch', { name: copy[language.id].choicePause });
    await toggle.waitFor();
    assert.equal(await toggle.innerText(), '');
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    if (language.id === 'en') {
      const frozen = await snapshot(page);
      await page.waitForFunction(() => window.__gameDebug.getModel().selections.length > 0);
      assert.equal(
        await page.evaluate(() => window.__gameDebug.getModel().selections[0].automatic),
        true,
      );
      assert.ok((await snapshot(page)).tick < frozen.tick + 15);
    }
    checks.push({ language: language.id, iconOnly: true });
    console.log('PASS localized choice toggle', language.id);
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/choice-pause.json', JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
