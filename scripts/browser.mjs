// Browser checks: `npm run check:browser -- <scenario...>`. Uses GAME_URL when set,
// otherwise starts its own dev server on a free port. BROWSER_PATH picks the executable.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './launch.mjs';

const scenarios = { smoke, choices, 'late-game': lateGame, languages: languageLayout };
const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const names = !wanted.length || wanted.includes('all') ? Object.keys(scenarios) : wanted;
for (const name of names) if (!scenarios[name]) throw new Error(`unknown scenario: ${name}`);

let server;

// Runs after every helper below is defined.
async function main() {
  const started = performance.now();
  server = await serve();
  const browser = await launchBrowser();
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

  // Values exactly as the old game saved them.
  await page.evaluate(() => {
    localStorage.setItem(
      'singularity.record',
      '{"outcome":"success","xp":5200,"level":31,"seed":12345,"collisionTime":1010.5}',
    );
    localStorage.setItem('singularity.beyond', '{"seconds":214.25,"xp":900,"seed":777}');
    localStorage.setItem('singularity.language', '"ko"');
    localStorage.setItem('singularity.sound', 'false');
  });
  await page.reload();
  await loaded(page);
  const records = await page.locator('.preparation .records').innerText();
  assert.match(records, /최고 기록\s+특이점 · 누적 경험치 5200/);
  assert.match(records, /특이점 너머로\s+∞ 03:34 · 추가 경험치 900/);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko');
  assert.equal(await title.getAttribute('aria-pressed'), 'false');
  pass('old saved records, language and sound show on the title', { records });
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

  await page.getByRole('button', { name: 'BEYOND' }).click();
  await page.evaluate(() => window.__gameDebug.advance(3000));
  await page.getByRole('progressbar', { name: 'Round 7' }).waitFor({ timeout: 2000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('.pause-panel').getByRole('button', { name: 'End run' }).click();
  await page.locator('.pause-panel.is-confirming').getByRole('button', { name: 'End run' }).click();
  const beyond = page.getByRole('dialog', { name: 'BEYOND' });
  await beyond.waitFor({ timeout: 2000 });
  assert.match(await beyond.innerText(), /New best/);
  assert.match(await page.locator('.result .records').innerText(), /BEYOND\s+∞ 00:0\d/);
  pass('beyond the clear, endless mode opens round 7 and quitting records it');
}

// Layout problems a player would see: page overflow, small or offscreen buttons, clipped card
// text, overlapping HUD items and untranslated Korean.
async function layout(page, language, scope = 'body') {
  const issues = await page.evaluate(
    ([language, scope]) => {
      const issues = [],
        root = document.documentElement;
      if (root.scrollWidth > innerWidth || root.scrollHeight > innerHeight)
        issues.push('page overflow');
      for (const button of document.querySelectorAll('button')) {
        if (button.closest('[inert]') || !button.checkVisibility()) continue;
        const r = button.getBoundingClientRect(),
          name = button.getAttribute('aria-label') ?? button.textContent;
        if (button.matches('.slot-inspect')) continue;
        if (r.width < 32 || r.height < 32) issues.push(`small: ${name} ${r.width}x${r.height}`);
        if (
          r.left < -0.5 ||
          r.top < -0.5 ||
          r.right > innerWidth + 0.5 ||
          r.bottom > innerHeight + 0.5
        )
          issues.push('offscreen: ' + name);
      }
      for (const node of document.querySelectorAll(
        '.card-label, .card strong, .card-value, .card-foot, .arena-caption h1, .event-banner',
      ))
        if (node.scrollWidth > node.clientWidth + 1) issues.push('clipped: ' + node.textContent);
      const hud = [...document.querySelectorAll('.hud-top > *')].map((n) =>
        n.getBoundingClientRect(),
      );
      for (let i = 1; i < hud.length; i++)
        if (hud[i].left < hud[i - 1].right - 0.5) issues.push('overlapping HUD');
      if (hud.length && (hud[0].left < 0 || hud.at(-1).right > innerWidth))
        issues.push('offscreen HUD');
      if (language !== 'ko') {
        const text = [...document.querySelectorAll(scope)].map((n) => n.innerText).join(' ');
        const korean = text.match(/[가-힣]+/g)?.filter((word) => word !== '한국어');
        if (korean?.length) issues.push('untranslated: ' + korean.slice(0, 3).join(' '));
      }
      return issues;
    },
    [language, scope],
  );
  const size = page.viewportSize();
  assert.deepEqual(issues, [], `${language} ${size.width}x${size.height}`);
}

// Every language on a small phone, a large phone and a landscape phone: title, help, HUD at its
// widest, cards, pause, and the result.
async function languageLayout(page) {
  const { copy, languages } = await import('../src/ui/text/index.ts');
  const { iconIds } = await import('../src/art/skills.ts');
  await open(page);
  for (const { id, label, html } of languages) {
    const c = copy[id];
    for (const [width, height] of [
      [320, 568],
      [430, 932],
      [812, 375],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.__gameDebug.prepare(10004));
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction((html) => document.documentElement.lang === html, html);
      await layout(page, id);
      await page.getByRole('button', { name: c.guide, exact: true }).click();
      assert.equal(await page.locator('.skill-guide > div').count(), iconIds.length);
      await layout(page, id, '.guide');
      await page.getByRole('button', { name: c.close, exact: true }).click();

      await page.getByRole('button', { name: 'START', exact: true }).click();
      await page.locator('.hud').waitFor();
      // The widest HUD: high level, the Higgs due and mass near the limit.
      await page.evaluate(() => {
        const debug = window.__gameDebug;
        debug.restart(10004, false);
        const game = debug.getGame();
        game.xp = 500000;
        game.mass = 900;
        game.bossCount = game.rules.bosses.length;
        game.tick = game.rules.higgs.time * game.rules.time.tickRate - 1;
        debug.advance(20);
      });
      await layout(page, id);
      await page.evaluate(() => {
        const debug = window.__gameDebug;
        debug.restart(10004);
        for (let i = 0; i < 1200 && !debug.getGame().choice; i++) debug.advance(100);
      });
      await page.locator('.card').first().waitFor();
      await layout(page, id, '.choices');
      if (width === 430) {
        await page.waitForTimeout(200); // the cards fade in
        await page.screenshot({ path: `artifacts/browser-cards-${id}.png` });
      }
      await page.getByRole('button', { name: c.pause, exact: true }).click();
      await layout(page, id, '.pause-panel');
      await page.getByRole('button', { name: c.quit, exact: true }).click();
      await layout(page, id, '.pause-panel');
      await page.getByRole('button', { name: c.back, exact: true }).click();
      await page.getByRole('button', { name: c.resume, exact: true }).click();

      await page.evaluate(() => {
        const debug = window.__gameDebug;
        debug.restart(10004, false);
        const game = debug.getGame();
        game.bossCount = game.rules.bosses.length;
        game.tick = game.rules.higgs.time * game.rules.time.tickRate - 1;
        debug.advance(20);
        game.damageTarget(
          game.targets.find((t) => t.final),
          1e12,
        );
        for (let i = 0; i < 20 && game.phase !== 'result'; i++) debug.advance(500);
      });
      await page.getByRole('heading', { name: c.success, exact: true }).waitFor();
      await layout(page, id, '.result');
    }
    pass(`${id} fits at three sizes`);
  }
}

await main();
