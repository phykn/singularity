import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { Game } from '../src/game.ts';
import { copy } from '../src/i18n.ts';
import { rules } from '../src/rules.ts';
import { runKey } from '../src/storage.ts';

const base = process.env.GAME_URL ?? 'http://localhost:8081';
const executablePath = process.env.BROWSER_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ ...devices['Pixel 7'] });
const checks = [], errors = [], c = copy.ko;
const fields = ['seed', 'phase', 'tick', 'elapsedTicks', 'xp', 'mass', 'radius', 'angle', 'ranks', 'boosts', 'rarities', 'targets', 'marks', 'effects', 'damageNumbers', 'choice', 'selections', 'result'];
const state = (g) => Object.fromEntries(fields.map(key => [key, g[key]]));
const snapshot = (page) => page.evaluate((fields) => {
  const g = window.__gameDebug.getModel();
  return Object.fromEntries(fields.map(key => [key, g[key]]));
}, fields);
const report = (task, details) => { checks.push({ task, details }); console.log('PASS ' + task, JSON.stringify(details)); };
const open = async () => {
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  if (base.includes('ngrok')) await page.setExtraHTTPHeaders({ 'ngrok-skip-browser-warning': 'true' });
  await page.goto(base + '/?seed=10004');
  await page.waitForFunction(() => !!window.__gameDebug);
  return page;
};
const verifyRestored = async (page, checkpoint) => {
  const actual = await snapshot(page), expected = Game.restore(checkpoint);
  assert.ok(expected);
  assert.ok(actual.elapsedTicks >= checkpoint.ticks && actual.elapsedTicks - checkpoint.ticks < 120, 'Returning must not simulate background time');
  expected.advance((actual.elapsedTicks - checkpoint.ticks) * 1000 / rules.tickRate);
  assert.deepEqual(actual, state(expected));
  assert.equal(await page.locator('.app').innerText().then(t => t.includes('undefined')), false);
  return actual;
};
mkdirSync('artifacts/v6', { recursive: true });
try {
  let page = await open();
  await page.getByRole('button', { name: 'START' }).click();
  await page.evaluate(() => { for (let i = 0; i < 120 && !window.__gameDebug.getModel().choice; i++) window.__gameDebug.advance(250); });
  await page.locator('.card').nth(1).click();
  await page.evaluate(() => {
    for (let i = 0; i < 360 && !window.__gameDebug.getModel().choice; i++) window.__gameDebug.advance(250);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), runKey);
  assert.equal(saved.inputs.length, 1);
  const before = await snapshot(page);
  assert.ok(before.choice);
  await page.reload(); await page.waitForFunction(() => !!window.__gameDebug);
  const restored = await verifyRestored(page, saved);
  assert.deepEqual(restored.choice, before.choice);
  assert.equal(restored.selections[0].automatic, false);
  await page.locator('.xp-status').getByText(c.xp, { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/v6/resumed-cards.png' });
  report('Android viewport reload restores the manual build and pending cards', { seed: restored.seed, xp: restored.xp, level: 1 + rules.levelXp.filter(x => x <= restored.xp).length, manualInputs: saved.inputs.length });

  await page.getByRole('button', { name: c.pause, exact: true }).click();
  const paused = await snapshot(page);
  await page.reload(); await page.waitForFunction(() => !!window.__gameDebug);
  await page.getByRole('button', { name: c.resume, exact: true }).waitFor();
  assert.deepEqual(await snapshot(page), paused);
  await page.waitForTimeout(500); assert.deepEqual(await snapshot(page), paused);
  await page.getByRole('button', { name: c.resume, exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok((await snapshot(page)).tick > paused.tick);
  report('manual pause survives a reload and resumes only when requested', { pausedAt: paused.tick });

  await page.evaluate(() => { window.__gameDebug.restart(10004); window.__gameDebug.advance(240000); });
  await page.waitForTimeout(1200);
  const periodic = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), runKey);
  assert.ok(periodic.ticks >= 240 * rules.tickRate);
  const cdp = await context.newCDPSession(page);
  await new Promise(resolve => { page.once('crash', resolve); void cdp.send('Page.crash').catch(resolve); });
  await page.close();
  page = await open();
  const afterCrash = await verifyRestored(page, periodic);
  await page.screenshot({ path: 'artifacts/v6/resumed-after-crash.png' });
  report('a terminated renderer recovers the periodic save without an unload event', { savedTicks: periodic.ticks, restoredTicks: afterCrash.elapsedTicks });

  await page.evaluate(() => { window.__gameDebug.restart(10004); window.__gameDebug.advance(610000); });
  await page.getByRole('heading', { name: c.success, exact: true }).waitFor();
  const result = (await snapshot(page)).result;
  await page.reload(); await page.getByRole('heading', { name: c.success, exact: true }).waitFor();
  assert.deepEqual((await snapshot(page)).result, result);
  report('a completed run survives reloading without starting a new game', { seconds: result.seconds, xp: result.xp });
  await page.getByRole('button', { name: c.retry, exact: true }).click();
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.getByRole('button', { name: c.pause, exact: true }).click();
  await page.getByRole('button', { name: c.quit, exact: true }).click();
  await page.getByRole('button', { name: c.quitConfirm, exact: true }).click();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), runKey), null);
  await page.reload(); await page.getByRole('button', { name: 'START', exact: true }).waitFor();
  report('explicitly ending a run clears its save', { phase: (await snapshot(page)).phase });

  await page.evaluate(() => {
    window.__gameDebug.restart(42, false);
    const g = window.__gameDebug.getModel();
    g.boosts.power = 3; g.rarities.power = 'legendary'; g.ranks.multi = 1;
    g.targets = Array.from({ length: 4 }, (_, id) => {
      const x = 180 + id * 22, y = 142 + id * 12;
      return { id, x, y, hp: 60, maxHp: 60, kind: 'dense', xp: 5, mass: 5, size: 8, radius: Math.hypot(x - 180, y - 260), angle: Math.atan2(y - 260, x - 180), speed: 0, turn: 0 };
    });
    g.fireBasic(); g.advance(100); g.setHidden(true); window.__gameDebug.advance(0);
  });
  const damage = await page.evaluate(() => window.__gameDebug.getModel().damageNumbers);
  assert.ok(damage.length >= 2); assert.ok(damage.every(n => n.value === 7.4));
  await page.waitForTimeout(150); await page.screenshot({ path: 'artifacts/v6/damage-numbers.png' });
  report('damage numbers render fractional upgraded damage on a mobile screen', { values: damage.map(n => n.value), scaleFactor: devices['Pixel 7'].deviceScaleFactor });
  await page.close();
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/resume.json', JSON.stringify({ version: rules.designVersion, device: 'Pixel 7 emulation on desktop Chrome', checks, errors }, null, 2));
} finally { await browser.close(); }
