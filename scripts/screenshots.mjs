import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, launchBrowser } from './browser-support.mjs';

const browser = await launchBrowser();
const shots = [],
  errors = [];
mkdirSync('docs/images', { recursive: true });
mkdirSync('artifacts', { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'ENG', exact: true }).click();
  await page.evaluate(() => window.__gameDebug.prepare(1701));
  await page.waitForFunction(() => document.querySelector('.start')?.matches(':enabled'));
  const shoot = async (number) => {
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `docs/images/gameplay-${number}.jpg`,
      type: 'jpeg',
      quality: 92,
    });
    shots.push(
      await page.evaluate(() => {
        const g = window.__gameDebug.getModel();
        return {
          seed: g.seed,
          tick: g.tick,
          ranks: g.ranks,
          selections: g.selections,
          targets: g.targets.length,
        };
      }),
    );
  };
  const combat = async (seconds) => {
    await page.evaluate((seconds) => {
      const debug = window.__gameDebug,
        g = debug.getModel();
      g.setHidden(false);
      debug.advance(Math.max(0, seconds - g.seconds) * 1000);
      for (let i = 0; i < 600 && (g.choice || !g.effects.some((fx) => fx.kind === 'bolt')); i++)
        debug.advance(1000 / g.rules.tickRate);
      if (g.phase !== 'running' || g.choice) throw new Error('No natural combat frame');
      g.setHidden(true);
      debug.advance(0);
    }, seconds);
    await page.waitForFunction(() => !document.querySelector('.choices'));
  };
  await shoot(1);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.locator('.hud').waitFor();
  await combat(55);
  await page.evaluate(() => {
    const debug = window.__gameDebug,
      g = debug.getModel();
    g.setHidden(false);
    for (let i = 0; i < 9000 && !g.choice && g.phase === 'running'; i++)
      g.advance(1000 / g.rules.tickRate, Infinity, { stopAtChoice: true, choiceMilliseconds: 0 });
    debug.advance(0);
  });
  await page.locator('.card').first().waitFor();
  await shoot(2);
  await page.locator('.card.auto').click();
  await combat(240);
  await shoot(3);
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/readme-screenshots.json', JSON.stringify({ shots, errors }, null, 2));
  console.log('Captured the English title screen and two natural gameplay frames from seed 1701.');
} finally {
  await browser.close();
}
