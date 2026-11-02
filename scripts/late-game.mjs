import assert from 'node:assert/strict';
import { base, capture, launchBrowser } from './browser-support.mjs';
import { languages } from '../src/ui/i18n.ts';

// Late-game screens: boss bar, critical banner, evolution and pact cards at narrow viewports.
const browser = await launchBrowser();
const errors = [];
try {
  for (const language of languages) {
    for (const [width, height] of [
      [320, 568],
      [568, 320],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        isMobile: true,
        hasTouch: true,
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base);
      await page.waitForFunction(() => !!window.__gameDebug);
      await page.getByRole('button', { name: language.label, exact: true }).click();
      await page.getByRole('button', { name: 'START', exact: true }).click();
      await page.locator('.hud').waitFor();
      await page.evaluate(() => {
        const d = window.__gameDebug;
        d.restart(900000);
        const g = d.getModel();
        Object.assign(g.ranks, { chain: 5, multi: 5, pierce: 3, satellite: 5 });
        g.selections = Array.from({ length: 30 }, () => ({
          id: 'power',
          tick: 0,
          time: 0,
          rank: 1,
          rarity: 'common',
          automatic: false,
          beforeCombat: false,
          evolve: false,
        }));
        g.xp = g.rules.energyGoal * g.rules.boss.energyFraction;
        for (let i = 0; i < 4; i++) d.advance(50);
      });
      await page.locator('.boss-bar').waitFor();
      await page.locator('.event-banner[data-kind="boss"]').waitFor();
      await page.evaluate(() => {
        const d = window.__gameDebug,
          g = d.getModel();
        g.xp = g.rules.energyGoal * g.rules.critical.energyFraction;
        d.advance(50);
      });
      await page.locator('.event-banner[data-kind="critical"]').waitFor();
      await page.locator('.hud[data-critical="true"]').waitFor();
      const banner = await page.locator('.event-banner').boundingBox();
      assert.ok(banner.x >= 0 && banner.x + banner.width <= width, 'Banner must fit');
      await page.evaluate(() => {
        const d = window.__gameDebug,
          g = d.getModel();
        g.choice = {
          number: 31,
          opened: g.time,
          deadline: g.time + 8,
          cards: [
            { id: 'chain', rarity: 'epic', evolve: true },
            { id: 'overclock', rarity: 'common' },
            { id: 'greed', rarity: 'common' },
          ],
        };
        d.advance(0);
      });
      await page.locator('.cards[data-ready="true"]').waitFor();
      const clipped = await page
        .locator('.card-value, .card strong, .card-label, .card-foot')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const inner = node.getBoundingClientRect(),
                card = node.closest('.card'),
                outer = card.getBoundingClientRect(),
                padding = parseFloat(getComputedStyle(card).paddingLeft);
              return (
                node.scrollWidth > node.clientWidth + 1 ||
                inner.left < outer.left + padding - 1 ||
                inner.right > outer.right - padding + 1
              );
            })
            .map((node) => node.textContent),
        );
      assert.deepEqual(clipped, []);
      await capture(page, `artifacts/screens/late-cards-${language.id}-${width}.png`);
      await page.locator('.card[data-evolve="true"]').click();
      assert.equal(await page.evaluate(() => window.__gameDebug.getModel().evolved.chain), true);
      await page.locator('.slot[data-evolved="true"]').waitFor();
      await page.close();
      console.log('PASS late game', language.id, width, height);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
