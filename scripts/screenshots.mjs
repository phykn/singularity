// README images: `npm run screenshots` writes assets/readme/gameplay-{1,2,3}.jpg from seed 1706.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchBrowser, serve } from './launch.mjs';

const server = await serve(),
  browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => document.querySelector('.start')?.matches(':enabled'));
  await page.getByRole('button', { name: 'ENG', exact: true }).click();
  await page.evaluate(() => window.__gameDebug.prepare(1706));
  mkdirSync('assets/readme', { recursive: true });
  const shoot = async (number) => {
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `assets/readme/gameplay-${number}.jpg`,
      type: 'jpeg',
      quality: 92,
    });
  };
  // Plays on with the automatic pick until `seconds`, or until cards are on offer.
  const play = (seconds, untilChoice = false) =>
    page.evaluate(
      ([seconds, untilChoice]) => {
        const debug = window.__gameDebug,
          game = debug.getGame();
        while (game.phase === 'running' && game.time < seconds) {
          if (game.growth.choice) {
            if (untilChoice) break;
            game.choose(game.growth.automaticCard.id, game.growth.choice.number);
          }
          debug.advance(100);
        }
        return game.phase;
      },
      [seconds, untilChoice],
    );

  await shoot(1);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.locator('.hud').waitFor();
  await play(150);
  assert.equal(await play(400, true), 'running');
  await page.locator('.cards[data-ready="true"]').waitFor();
  await shoot(2);
  await page.locator('.card.auto').click();
  // The first giant particle, the gluon, arrives at 4:30 with its tethered quarks.
  assert.equal(await play(282), 'running');
  await page.locator('.boss-bar').waitFor();
  await shoot(3);
  assert.deepEqual(errors, []);
  console.log('Captured the title, a level-up and the gluon fight from seed 1706.');
} finally {
  await browser.close();
  await server.close();
}
