import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { copy, languages } from '../src/i18n.ts';
import { rules, rarityIds, skillIds, statIds } from '../src/rules.ts';

const base = process.env.GAME_URL ?? 'http://localhost:8081';
const executablePath = process.env.BROWSER_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const checks = [], errors = [];
mkdirSync('artifacts/v7', { recursive: true });
const inspect = async (page) => {
  const issues = await page.evaluate(() => {
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) issues.push('Page overflow');
    for (const button of document.querySelectorAll('button')) {
      if (button.closest('[inert]')) continue;
      const r = button.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) issues.push('Small target: ' + button.textContent);
      if (r.left < -.5 || r.top < -.5 || r.right > innerWidth + .5 || r.bottom > innerHeight + .5) issues.push('Offscreen: ' + button.textContent);
    }
    for (const node of document.querySelectorAll('.card-label, .card strong, .card-value, .arena-caption h1')) {
      if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1) issues.push('Clipped: ' + node.textContent);
    }
    return issues;
  });
  assert.deepEqual(issues, []);
};
const screenshot = async (page, path) => { await page.waitForTimeout(220); await page.screenshot({ path }); };
const localized = async (page, language, selector) => {
  if (language === 'ko') return;
  const text = await page.locator(selector).innerText();
  assert.equal(/[가-힣]/.test(text), false, 'Untranslated Korean: ' + text);
};
try {
  for (const language of languages) {
    const c = copy[language.id];
    for (const [width, height] of [[320,568],[360,640],[375,812],[430,932],[568,320],[812,375]]) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + '/?seed=10004');
      await page.waitForFunction(() => !!window.__gameDebug);
      await page.getByRole('button', { name: language.label, exact: true }).click();
      await page.waitForFunction((html) => document.documentElement.lang === html, language.html);
      assert.equal(await page.locator('.policy-picker, .planned, .arena-caption p').count(), 0);
      await inspect(page);
      if (width === 375) await screenshot(page, `artifacts/v7/ready-${language.id}.png`);
      await page.getByRole('button', { name: c.guide, exact: true }).click();
      assert.equal(await page.locator('.skill-guide > div').count(), 11);
      await localized(page, language.id, '.guide');
      await page.getByRole('button', { name: c.close, exact: true }).click();
      await page.getByRole('button', { name: 'START', exact: true }).click();
      await page.evaluate(() => {
        for (let i = 0; i < 120 && !window.__gameDebug.getModel().choice; i++) window.__gameDebug.advance(250);
      });
      await page.locator('.card').first().waitFor();
      assert.equal(await page.locator('.card').count(), 3);
      await localized(page, language.id, '.choices');
      await inspect(page);
      if (width === 375) await screenshot(page, `artifacts/v7/cards-${language.id}.png`);
      await page.getByRole('button', { name: c.pause, exact: true }).click();
      await inspect(page);
      const before = await page.evaluate(() => JSON.stringify({time:window.__gameDebug.getModel().time, choice:window.__gameDebug.getModel().choice}));
      if (width === 375) {
        const other = languages[(languages.indexOf(language) + 1) % languages.length];
        await page.getByRole('button', { name: other.label, exact: true }).click();
        await page.getByRole('button', { name: language.label, exact: true }).click();
      }
      await page.evaluate(() => window.__gameDebug.advance(10000));
      assert.equal(await page.evaluate(() => JSON.stringify({time:window.__gameDebug.getModel().time, choice:window.__gameDebug.getModel().choice})), before);
      await page.getByRole('button', { name: c.resume, exact: true }).click();
      const id = await page.evaluate(() => window.__gameDebug.getModel().choice.cards[1].id);
      await page.locator('.card').nth(1).click();
      assert.equal(await page.evaluate(() => window.__gameDebug.getModel().selections[0].id), id);
      assert.equal(await page.evaluate(() => window.__gameDebug.getModel().selections[0].automatic), false);
      await page.evaluate((goal) => { window.__gameDebug.restart(1, false); window.__gameDebug.xp(goal); window.__gameDebug.advance(610000); }, rules.energyGoal);
      await page.getByRole('heading', { name: c.success, exact: true }).waitFor();
      await localized(page, language.id, '.result');
      await inspect(page);
      await page.locator('.result summary').click();
      assert.equal(await page.locator('.result .dialog-body').evaluate(n => n.scrollWidth > n.clientWidth + 1), false, 'Result details overflow');
      if (width === 375) await screenshot(page, `artifacts/v7/result-${language.id}.png`);
      await page.getByRole('button', { name: c.retry, exact: true }).click();
      await page.evaluate((goal) => { window.__gameDebug.restart(1, false); window.__gameDebug.xp(goal - 1); const g = window.__gameDebug.getModel(); g.mass = 1000; g.radius = g.core + 4; window.__gameDebug.advance(16000); }, rules.energyGoal);
      await page.getByRole('heading', { name: c.failure, exact: true }).waitFor();
      await inspect(page);
      await page.getByRole('button', { name: c.newRun, exact: true }).click();
      await page.reload();
      await page.getByRole('button', { name: language.label, exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: language.label, exact: true }).getAttribute('aria-pressed'), 'true');
      await page.close();
      checks.push({ language: language.id, viewport: [width, height], flow: 'passed' });
      console.log('PASS', language.id, width, height);
    }
    if (language.id === 'ko') continue;
    for (const [width, height] of [[320,568],[568,320]]) {
      const page = await browser.newPage({viewport:{width,height}});
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base);
      await page.waitForFunction(() => !!window.__gameDebug);
      await page.getByRole('button', {name:language.label,exact:true}).click();
      const ids = [...skillIds, ...statIds];
      for (const rarity of rarityIds) for (let rank = 1; rank <= rules.maxRank; rank++) for (let i = 0; i < ids.length; i += 3) {
        await page.evaluate(({ids,rarity,rank}) => {
          window.__gameDebug.restart(1, false);
          const g = window.__gameDebug.getModel();
          for (const id of ids) { if (id in g.ranks) g.ranks[id] = rank - 1; else g.boosts[id] = rank - 1; }
          g.choice = {number:1,opened:0,deadline:8,cards:ids.map(id=>({id,rarity}))};
          window.__gameDebug.advance(0);
        }, {ids:[0,1,2].map(n=>ids[(i+n)%ids.length]),rarity,rank});
        await page.waitForTimeout(90);
        await inspect(page);
      }
      await page.close();
      checks.push({language:language.id,viewport:[width,height],cardVariants:132});
      console.log('PASS card variants', language.id, width, height);
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/languages.json', JSON.stringify({version:rules.designVersion,checks,errors},null,2));
} finally { await browser.close(); }
