// Browser checks: `npm run check:browser -- <scenario...>`. Uses GAME_URL when set,
// otherwise starts its own dev server on a free port. BROWSER_PATH picks the executable.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';

const scenarios = { smoke, choices, 'late-game': lateGame };
const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const names = !wanted.length || wanted.includes('all') ? Object.keys(scenarios) : wanted;
for (const name of names) if (!scenarios[name]) throw new Error(`unknown scenario: ${name}`);

let server;

// Runs after every helper below is defined.
async function main() {
  const started = performance.now();
  server = await serve();
  const browser = await launch();
  let failed = false;
  try {
    for (const name of names) {
      const context = await browser.newContext({
        viewport: { width: 375, height: 812 },
        locale: 'en-US',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
      try {
        await scenarios[name](page);
        assert.deepEqual(errors, [], 'page errors');
      } catch (error) {
        failed = true;
        mkdirSync('artifacts', { recursive: true });
        await page.screenshot({ path: `artifacts/browser-${name}.png` }).catch(() => {});
        console.error(`FAIL ${name}`, error);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(
    `${failed ? 'FAILED' : 'OK'} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
  process.exitCode = failed ? 1 : 0;
}

function pass(task, details = {}) {
  console.log('PASS ' + task, JSON.stringify(details));
}

async function serve() {
  if (process.env.GAME_URL) return { url: process.env.GAME_URL, close: async () => {} };
  const { createServer } = await import('vite');
  const vite = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 8090, strictPort: false },
  });
  await vite.listen();
  return { url: vite.resolvedUrls.local[0], close: () => vite.close() };
}

async function launch() {
  const { chromium } = await import('playwright');
  const executablePath =
    process.env.BROWSER_PATH ??
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find(existsSync);
  return chromium.launch({ headless: true, ...(executablePath && { executablePath }) });
}

// Every page records the audio contexts it opens.
async function open(page) {
  await page.addInitScript(() => {
    const Native = window.AudioContext,
      contexts = (window.soundContexts = []);
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        contexts.push(this);
      }
    };
  });
  await page.goto(server.url);
  await loaded(page);
}
function loaded(page) {
  return page.waitForFunction(
    () => window.__gameDebug && document.querySelector('.start')?.disabled === false,
  );
}

async function smoke(page) {
  await open(page);
  const title = page.locator('.title-sound');
  assert.equal(await title.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.soundContexts.length), 0);
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForFunction(() => window.soundContexts[0]?.state === 'running', null, {
    timeout: 5000,
  });
  pass('a fresh profile opens audio at START', { state: 'running' });

  const killAt = await page.evaluate(() => {
    const debug = window.__gameDebug;
    for (let second = 1; second <= 30; second++) {
      const game = debug.getGame(),
        from = game.events.length;
      debug.advance(1000);
      if (game.events.slice(from).some((event) => event.kind === 'kill')) return second;
    }
    return null;
  });
  assert.ok(killAt !== null, 'no kill in the first 30 seconds');
  pass('a particle pops within 30 seconds', { second: killAt });

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const setting = page.locator('.pause-panel .title-sound');
  await setting.click();
  assert.equal(await setting.getAttribute('aria-pressed'), 'false');
  await page.reload();
  await loaded(page);
  assert.equal(await title.getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.soundContexts.length), 0);
  pass('sound turned off stays off after a reload');

  const phase = await page.evaluate(() => {
    const debug = window.__gameDebug;
    for (let i = 0; i < 60 && debug.getGame().phase !== 'result'; i++) debug.advance(10000);
    return debug.getGame().phase;
  });
  assert.equal(phase, 'result');
  const result = page.getByRole('dialog', { name: 'Orbit collapse' });
  await result.waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: 'Retry' }).waitFor();
  pass('a loss reaches the result screen');
}

// Opens the next offer through the debug hook and returns its number.
async function offer(page) {
  return page.evaluate(() => {
    const debug = window.__gameDebug;
    for (let i = 0; i < 2400 && !debug.getGame().choice; i++) debug.advance(100);
    return debug.getGame().choice?.number ?? null;
  });
}
const picks = (page) => page.evaluate(() => window.__gameDebug.getGame().selections.length);

async function choices(page) {
  await open(page);
  await page.getByRole('button', { name: 'START' }).click();
  assert.equal(await offer(page), 1);
  const cards = page.locator('.cards button.card');
  await cards.first().waitFor();
  // A tap right after the cards appear is protected.
  const box = await cards.nth(1).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await picks(page), 0, 'an early tap picked a card');
  const ticks = await page.evaluate(() => window.__gameDebug.getGame().elapsedTicks);
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => window.__gameDebug.getGame().elapsedTicks),
    ticks,
    'combat ran during a paused choice',
  );
  await cards.nth(1).click();
  assert.equal(await picks(page), 1);
  pass('an early tap is ignored, a later one picks, combat waits', { ticks });

  assert.equal(await offer(page), 2);
  await cards.first().waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('.cards button.card'));
  await page.keyboard.press('End');
  const focused = await page.evaluate(() => document.activeElement.dataset.upgrade);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  const taken = await page.evaluate(() => window.__gameDebug.getGame().selections.at(-1).id);
  assert.equal(taken, focused);
  pass('keyboard moves between cards and Enter picks', { id: taken });

  assert.equal(await offer(page), 3);
  await page.getByRole('switch').click();
  assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'false');
  await page.waitForFunction(() => window.__gameDebug.getGame().selections.length >= 3, null, {
    timeout: 7000,
  });
  pass('with choice pause off the countdown picks by itself');
}

// Jumps the clock with spawning off: giants, the critical breach and the Higgs by time.
async function lateGame(page) {
  await open(page);
  await page.getByRole('button', { name: 'START' }).click();
  const jump = (seconds, skipGiants = false) =>
    page.evaluate(
      ([seconds, skipGiants]) => {
        const debug = window.__gameDebug,
          game = debug.getGame();
        if (skipGiants) game.bossCount = game.rules.bosses.length;
        game.tick = Math.round(seconds * game.rules.time.tickRate) - 1;
        debug.advance(1000 / game.rules.time.tickRate);
      },
      [seconds, skipGiants],
    );
  await page.evaluate(() => window.__gameDebug.restart(7, false));
  await jump(270);
  const banner = page.locator('.event-banner');
  await banner.filter({ hasText: 'GLUON INBOUND 1/5' }).waitFor({ timeout: 2000 });
  await page.locator('.boss-bar').waitFor();
  pass('the first giant arrives at 4:30 with its banner and health bar');

  await jump(840, true);
  await page.locator('.event-banner[data-kind="critical"]').waitFor({ timeout: 2000 });
  assert.equal(await page.locator('.hud').getAttribute('data-critical'), 'true');
  pass('the critical breach starts at 14:00');

  await jump(930);
  await banner.filter({ hasText: 'HIGGS INBOUND' }).waitFor({ timeout: 2000 });
  await page.getByRole('progressbar', { name: 'Destroy the Higgs' }).waitFor();
  assert.equal(await page.locator('.boss-bar').getAttribute('data-final'), 'true');
  await page.screenshot({ path: 'artifacts/browser-late-game-higgs.png' });
  pass('the Higgs arrives at 15:30 and the singularity meter is full');

  await page.evaluate(() => {
    const debug = window.__gameDebug,
      game = debug.getGame();
    game.damageTarget(
      game.targets.find((t) => t.final),
      1e12,
    );
    for (let i = 0; i < 20 && game.phase !== 'result'; i++) debug.advance(500);
  });
  await page.getByRole('dialog', { name: 'Singularity' }).waitFor({ timeout: 3000 });
  pass('popping the Higgs wins the run');
}

await main();
