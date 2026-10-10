import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { devices } from 'playwright';
import { base, capture, launchBrowser, observeScene } from './browser-support.mjs';
import { copy } from '../src/ui/i18n.ts';
import { rules } from '../src/game/rules.ts';

const browser = await launchBrowser();
const context = await browser.newContext({ ...devices['Pixel 7'] });
const checks = [],
  errors = [],
  c = copy.ko;
const fields = [
  'seed',
  'phase',
  'tick',
  'elapsedTicks',
  'xp',
  'mass',
  'radius',
  'angle',
  'ranks',
  'boosts',
  'rarities',
  'targets',
  'effects',
  'damageNumbers',
  'choice',
  'selections',
  'result',
];
const snapshot = (page) =>
  page.evaluate((fields) => {
    const g = window.__gameDebug.getModel();
    return Object.fromEntries(fields.map((key) => [key, g[key]]));
  }, fields);
const report = (task, details) => {
  checks.push({ task, details });
  console.log('PASS ' + task, JSON.stringify(details));
};
const open = async () => {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  if (base.includes('ngrok'))
    await page.setExtraHTTPHeaders({ 'ngrok-skip-browser-warning': 'true' });
  await observeScene(page);
  await page.goto(base + '/?seed=10004');
  await page.waitForFunction(() => !!window.__gameDebug);
  return page;
};
mkdirSync('artifacts/screens', { recursive: true });
try {
  let page = await open();
  const seen = new Set();
  const verifyFresh = async (previous) => {
    await page.getByRole('button', { name: 'START', exact: true }).waitFor();
    const game = await snapshot(page);
    assert.equal(game.phase, 'ready');
    assert.equal(game.tick, 0);
    assert.equal(game.xp, 0);
    assert.equal(game.choice, null);
    assert.deepEqual(game.selections, []);
    assert.notEqual(game.seed, previous);
    assert.ok(!seen.has(game.seed), 'A new page repeated a seed');
    seen.add(game.seed);
    return game.seed;
  };
  let seed = await verifyFresh();
  const history = await page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    for (let i = 0; i < 5000; i++) g.log('hit', { kind: 'small', damage: 1 });
    return { retained: g.events.length, total: g.eventCount };
  });
  assert.ok(history.retained <= 1024);
  assert.equal(history.total, 5000);
  report('normal browser play bounds event history while retaining recent sound cues', history);
  for (let i = 0; i < 4; i++) {
    await page.reload();
    await page.waitForFunction(() => !!window.__gameDebug);
    seed = await verifyFresh(seed);
  }
  report('refresh uses a new seed even when the URL contains a seed parameter', {
    seeds: [...seen],
  });

  await page.getByRole('button', { name: 'START' }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 120 && !window.__gameDebug.getModel().choice; i++)
      window.__gameDebug.advance(250);
  });
  await page.locator('.card').nth(1).click();
  await page.getByRole('button', { name: c.pause, exact: true }).click();
  const paused = await snapshot(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.deepEqual(await snapshot(page), paused);
  await page.getByRole('button', { name: c.resume, exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal((await snapshot(page)).seed, paused.seed);
  assert.ok((await snapshot(page)).tick > paused.tick);
  await page.getByRole('button', { name: c.pause, exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => !!window.__gameDebug);
  seed = await verifyFresh(seed);
  await capture(page, 'artifacts/screens/fresh-after-reload.png');
  report('backgrounding resumes the live run; refreshing discards its build and pause', { seed });

  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      g.start();
      window.__gameDebug.advance(1800000);
    });
    const completed = await page.evaluate(
      () => window.__gameDebug.getModel().result.outcome === 'success',
    );
    await page.getByRole('button', { name: completed ? c.finish : c.retry, exact: true }).click();
    seed = await verifyFresh(seed);
  }
  assert.ok(await page.evaluate(() => localStorage.getItem('singularity.record')));
  report('successive restarts generate fresh seeds', { seed });

  await page.getByRole('button', { name: 'START' }).click();
  await page.getByRole('button', { name: c.pause, exact: true }).click();
  await page.getByRole('button', { name: c.quit, exact: true }).click();
  await page.getByRole('button', { name: c.quitConfirm, exact: true }).click();
  seed = await verifyFresh(seed);
  report('ending a run returns to a new seed', { seed });

  await page.evaluate(() => {
    localStorage.setItem('singularity.language', JSON.stringify('en'));
    localStorage.setItem('singularity.settings', JSON.stringify({ sound: true }));
  });
  const record = await page.evaluate(() => localStorage.getItem('singularity.record'));
  await page.reload();
  await page.waitForFunction(() => !!window.__gameDebug);
  seed = await verifyFresh(seed);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: copy.en.settings, exact: true }).click();
  assert.equal(
    await page.locator('.settings-panel .setting-row').first().getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('singularity.record')), record);
  await page.getByRole('button', { name: copy.en.close, exact: true }).click();
  await page.getByRole('button', { name: '한국어', exact: true }).click();
  report('fresh runs preserve language, sound preferences and best results', {});

  await page.getByRole('button', { name: 'START' }).click();
  await page.evaluate(() => window.__gameDebug.advance(10000));
  const cdp = await context.newCDPSession(page);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Renderer crash timed out')), 30000);
    page.once('crash', () => {
      clearTimeout(timeout);
      resolve();
    });
    void cdp.send('Page.crash').catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  await page.close();
  page = await open();
  seed = await verifyFresh(seed);
  await capture(page, 'artifacts/screens/fresh-after-crash.png');
  report('a terminated renderer opens a fresh run instead of replaying the old seed', { seed });

  await page.evaluate(() => {
    window.__gameDebug.restart(42, false);
    const g = window.__gameDebug.getModel();
    g.boosts.power = 3;
    g.rarities.power = 'legendary';
    g.ranks.multi = 1;
    g.targets = Array.from({ length: 4 }, (_, id) => {
      const x = 180 + id * 22,
        y = 142 + id * 12;
      return {
        id,
        x,
        y,
        hp: 60,
        maxHp: 60,
        kind: 'dense',
        particle: 'proton',
        born: 0,
        xp: 5,
        mass: 5,
        size: 8,
        radius: Math.hypot(x - 180, y - 260),
        angle: Math.atan2(y - 260, x - 180),
        speed: 0,
        turn: 0,
      };
    });
    g.combat.fireBasic();
    g.advance(100);
    g.setHidden(true);
    window.__gameDebug.advance(0);
  });
  const damage = await page.evaluate(() => window.__gameDebug.getModel().damageNumbers);
  const power = rules.baseHitDamage + 3 * rules.damagePerRank * rules.rarity.legendary.scale;
  const expectedDamage = [power, power / (1 + rules.skills.multi.spreadCost)];
  assert.equal(damage.length, 2);
  assert.ok(damage.every((n, i) => Math.abs(n.value - expectedDamage[i]) < 1e-8));
  await page.waitForTimeout(150);
  const labels = await page.evaluate(() =>
    window.__gameScene.damageLabels.texts.filter((text) => text.visible).map((text) => text.text),
  );
  assert.deepEqual(
    labels,
    damage
      .slice()
      .reverse()
      .map((n) => String(Math.round(n.value))),
  );
  await capture(page, 'artifacts/screens/damage-numbers.png');
  report('integer damage labels preserve fractional upgraded combat damage on a mobile screen', {
    values: damage.map((n) => n.value),
    labels,
    scaleFactor: devices['Pixel 7'].deviceScaleFactor,
  });
  await page.close();
  const failed = await browser.newPage({ ...devices['Pixel 7'] });
  failed.on('pageerror', (error) => errors.push(error.message));
  await failed.goto(base + '/?seed=10004');
  await failed.getByRole('button', { name: 'START', exact: true }).click();
  await failed.evaluate(() => {
    const write = Storage.prototype.setItem;
    window.restoreWrites = () => {
      Storage.prototype.setItem = write;
    };
    window.recordAttempts = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'singularity.record') {
        window.recordAttempts++;
        throw new Error('record write blocked');
      }
      return write.call(this, key, value);
    };
    window.__gameDebug.xp(window.__gameDebug.getModel().rules.energyGoal);
    window.__gameDebug.advance(10000);
  });
  await failed.locator('.result .setting-notice').waitFor();
  await failed.waitForFunction(() => window.recordAttempts >= 2);
  assert.equal(await failed.evaluate(() => localStorage.getItem('singularity.record')), null);
  assert.equal(await failed.locator('.result .setting-notice').innerText(), c.storageFailed);
  await failed.evaluate(() => window.restoreWrites());
  await failed.waitForFunction(() => !!localStorage.getItem('singularity.record'));
  await failed.locator('.result .setting-notice').waitFor({ state: 'hidden' });
  report('a failed best-result write retries until it succeeds', {
    outcome: await failed.evaluate(
      () => JSON.parse(localStorage.getItem('singularity.record')).outcome,
    ),
  });

  await failed.getByRole('button', { name: c.finish, exact: true }).click();
  await failed.getByRole('button', { name: c.settings, exact: true }).click();
  await failed.evaluate(() => {
    const write = Storage.prototype.setItem;
    window.restoreWrites = () => {
      Storage.prototype.setItem = write;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'singularity.settings') throw new Error('settings write blocked');
      return write.call(this, key, value);
    };
  });
  await failed.locator('.settings-panel .setting-row').first().click();
  await failed.locator('.settings-panel .setting-notice').waitFor();
  await failed.locator('.settings-panel .language-picker button').first().click();
  await failed.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(
    await failed.locator('.settings-panel .setting-notice').innerText(),
    c.storageFailed,
  );
  await failed.evaluate(() => window.restoreWrites());
  await failed.locator('.settings-panel .setting-row').first().click();
  await failed.locator('.settings-panel .setting-notice').waitFor({ state: 'hidden' });
  report('saving another preference does not hide an unsaved settings warning', {});
  await failed.close();
  const records = await browser.newContext();
  const a = await records.newPage(),
    b = await records.newPage();
  for (const p of [a, b]) {
    p.on('pageerror', (error) => errors.push(error.message));
    await p.goto(base);
    await p.waitForFunction(() => !!window.__gameDebug);
  }
  const finish = async (p, success, seed) => {
    await p.bringToFront();
    await p.evaluate(
      ({ success, seed }) => {
        const d = window.__gameDebug;
        d.restart(seed, false);
        if (success) d.xp(d.getModel().rules.energyGoal);
        else {
          const g = d.getModel();
          g.mass = 1e9;
          g.radius = g.core + g.rules.electronRadius;
        }
        d.advance(10000);
      },
      { success, seed },
    );
    await p.locator('#result-title').waitFor();
  };
  await finish(b, true, 42);
  await b.waitForFunction(
    () => JSON.parse(localStorage.getItem('singularity.record') ?? 'null')?.outcome === 'success',
  );
  const best = await b.evaluate(() => JSON.parse(localStorage.getItem('singularity.record')));
  await finish(a, false, 43);
  await a.waitForTimeout(150);
  assert.deepEqual(
    await a.evaluate(() => JSON.parse(localStorage.getItem('singularity.record'))),
    best,
  );
  const retire = async (p, seconds) => {
    await p.bringToFront();
    await p.waitForFunction(() => !document.querySelector('.result button.primary').disabled);
    await p.getByRole('button', { name: c.beyond, exact: true }).click();
    await p.evaluate((seconds) => {
      const d = window.__gameDebug,
        g = d.getModel();
      d.advance(g.rules.endless.entrySeconds * 1000 + seconds * 1000);
      g.retire();
      d.advance(0);
    }, seconds);
    await p.waitForFunction(() => window.__gameDebug.getModel().result?.outcome === 'retired');
    await p.waitForTimeout(150);
  };
  await retire(b, 30);
  const beyondBest = await b.evaluate(() => JSON.parse(localStorage.getItem('singularity.beyond')));
  assert.ok(beyondBest.seconds >= 30);
  await finish(a, true, 43);
  await retire(a, 5);
  assert.deepEqual(
    await a.evaluate(() => JSON.parse(localStorage.getItem('singularity.beyond'))),
    beyondBest,
  );
  report('stale tabs preserve the higher normal and endless records', { best, beyondBest });
  await records.close();
  assert.deepEqual(errors, []);
  writeFileSync(
    'artifacts/resume.json',
    JSON.stringify({ device: 'Pixel 7 emulation on desktop Chrome', checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
