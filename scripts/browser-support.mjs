import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { chromium } from 'playwright';

export const base = process.env.GAME_URL ?? 'http://localhost:8081';
export const screenshotsDir = join(
  'artifacts/screenshots',
  new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid,
);
let screenshotCount = 0;

export async function capture(page, path) {
  mkdirSync(screenshotsDir, { recursive: true });
  mkdirSync(dirname(path), { recursive: true });
  const archived = join(
    screenshotsDir,
    String(++screenshotCount).padStart(3, '0') + '-' + basename(path),
  );
  await page.screenshot({ path: archived });
  copyFileSync(archived, path);
  return archived;
}

export function launchBrowser() {
  const executablePath =
    process.env.BROWSER_PATH ??
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find(existsSync);
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
}

// Observe the renderer in development checks without shipping another debug hook.
export async function observeScene(page) {
  await page.route('**/src/render/ElectronScene.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst create = ElectronScene.prototype.create; ElectronScene.prototype.create = function(...args) { window.__gameScene = this; return create.apply(this, args); };',
    });
  });
}

// Result-layout fixtures must not depend on whether a seed wins after balance tuning.
// Full-game balance checks separately exercise natural successes and failures.
export async function showSuccess(page, seed = 96048) {
  await page.evaluate((seed) => {
    const debug = window.__gameDebug;
    debug.restart(seed, false);
    const g = debug.getModel();
    g.tick = g.rules.stageStarts[2] * g.rules.tickRate;
    g.elapsedTicks = g.tick;
    for (let i = 0; i < 80; i++) g.spawnBatch();
    g.ranks.multi = 3;
    g.ranks.chain = 3;
    g.rarities.multi = 'rare';
    g.rarities.chain = 'epic';
    g.boosts.power = 3;
    g.boosts.rate = 2;
    debug.xp(g.rules.energyGoal);
    debug.advance(16000);
  }, seed);
}
