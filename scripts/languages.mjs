import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, capture, launchBrowser } from './browser-support.mjs';
import { copy, languages } from '../src/ui/i18n.ts';
import { rules, rarityIds, upgradeIds } from '../src/game/rules.ts';
import { particleIds } from '../src/game/particles.ts';
import { particleNames } from '../src/ui/i18n.ts';

const browser = await launchBrowser();
const checks = [],
  errors = [];
mkdirSync('artifacts/screens', { recursive: true });
const inspect = async (page) => {
  const issues = await page.evaluate(() => {
    const issues = [];
    if (
      document.documentElement.scrollWidth > innerWidth ||
      document.documentElement.scrollHeight > innerHeight
    )
      issues.push('Page overflow');
    for (const button of document.querySelectorAll('button')) {
      if (button.closest('[inert]')) continue;
      const r = button.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) issues.push('Small target: ' + button.textContent);
      if (
        r.left < -0.5 ||
        r.top < -0.5 ||
        r.right > innerWidth + 0.5 ||
        r.bottom > innerHeight + 0.5
      )
        issues.push('Offscreen: ' + button.textContent);
    }
    for (const node of document.querySelectorAll(
      '.card-label, .card strong, .card-value, .arena-caption h1, .upgrade-feedback',
    )) {
      if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
        issues.push('Clipped: ' + node.textContent);
    }
    for (const node of document.querySelectorAll(
      '.result-build span:not(.rank), .result-build small',
    )) {
      const bounds = node.getBoundingClientRect(),
        card = node.closest('[data-rarity]'),
        outer = card.getBoundingClientRect(),
        css = getComputedStyle(card);
      if (
        bounds.left < outer.left + parseFloat(css.paddingLeft) - 0.5 ||
        bounds.right > outer.right - parseFloat(css.paddingRight) + 0.5
      )
        issues.push('Result text outside card: ' + node.textContent);
    }
    const hud = [...document.querySelectorAll('.hud-top > *')].map((n) =>
      n.getBoundingClientRect(),
    );
    for (let i = 1; i < hud.length; i++) {
      if (hud[i].left < hud[i - 1].right - 0.5) issues.push('Overlapping HUD');
      if (Math.abs(hud[i].y + hud[i].height / 2 - hud[0].y - hud[0].height / 2) > 0.5)
        issues.push('Misaligned HUD');
    }
    if (hud.length && (hud[0].left < 0 || hud.at(-1).right > innerWidth))
      issues.push('Offscreen HUD');
    return issues;
  });
  assert.deepEqual(issues, []);
};
const screenshot = async (page, path) => {
  await page.waitForTimeout(220);
  await capture(page, path);
};
const localized = async (page, language, selector) => {
  if (language === 'ko') return;
  const text = await page.locator(selector).innerText();
  assert.equal(/[가-힣]/.test(text), false, 'Untranslated Korean: ' + text);
};
try {
  for (const language of languages) {
    const c = copy[language.id];
    for (const [width, height] of [
      [320, 568],
      [360, 640],
      [375, 812],
      [430, 932],
      [520, 320],
      [568, 320],
      [812, 375],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        isMobile: true,
        hasTouch: true,
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + '/?seed=10004');
      await page.waitForFunction(() => !!window.__gameDebug);
      await page.getByRole('button', { name: language.label, exact: true }).click();
      await page.waitForFunction((html) => document.documentElement.lang === html, language.html);
      assert.equal(await page.locator('.policy-picker, .planned, .arena-caption p').count(), 0);
      await inspect(page);
      if (width === 375) await screenshot(page, `artifacts/screens/ready-${language.id}.png`);
      await page.getByRole('button', { name: c.guide, exact: true }).click();
      assert.equal(await page.locator('.skill-guide > div').count(), upgradeIds.length);
      assert.deepEqual(
        await page.locator('.particle-guide span').allTextContents(),
        Object.values(particleNames[language.id]),
      );
      await localized(page, language.id, '.guide');
      await page.getByRole('button', { name: c.close, exact: true }).click();
      await page.getByRole('button', { name: 'START', exact: true }).click();
      await page.evaluate(() => {
        const g = window.__gameDebug.getModel();
        g.setHidden(true);
        for (const id of ['power', 'rate', 'range']) {
          g.boosts[id] = 1000;
          g.rarities[id] = 'legendary';
        }
        g.xp = g.rules.energyGoal;
        g.elapsedTicks = 3661 * g.rules.tickRate;
        window.__gameDebug.advance(0);
      });
      await page.waitForFunction(() => document.querySelector('.charge b')?.textContent === '100%');
      await inspect(page);
      if (language.id === 'ko')
        await screenshot(page, `artifacts/screens/hud-max-${width}x${height}.png`);
      await page.evaluate(() => window.__gameDebug.restart(10004));
      await page.evaluate(() => {
        for (let i = 0; i < 120 && !window.__gameDebug.getModel().choice; i++)
          window.__gameDebug.advance(250);
      });
      await page.locator('.card').first().waitFor();
      assert.equal(await page.locator('.card').count(), 3);
      await localized(page, language.id, '.choices');
      await inspect(page);
      if (width === 375) await screenshot(page, `artifacts/screens/cards-${language.id}.png`);
      await page.getByRole('button', { name: c.pause, exact: true }).click();
      await inspect(page);
      const before = await page.evaluate(() =>
        JSON.stringify({
          time: window.__gameDebug.getModel().time,
          choice: window.__gameDebug.getModel().choice,
        }),
      );
      if (width === 375) {
        const other = languages[(languages.indexOf(language) + 1) % languages.length];
        await page.getByRole('button', { name: other.label, exact: true }).click();
        await page.getByRole('button', { name: language.label, exact: true }).click();
      }
      await page.evaluate(() => window.__gameDebug.advance(10000));
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify({
            time: window.__gameDebug.getModel().time,
            choice: window.__gameDebug.getModel().choice,
          }),
        ),
        before,
      );
      await page.getByRole('button', { name: c.resume, exact: true }).click();
      const id = await page.evaluate(() => window.__gameDebug.getModel().choice.cards[1].id);
      await page.locator('.card').nth(1).click();
      assert.equal(await page.evaluate(() => window.__gameDebug.getModel().selections[0].id), id);
      assert.equal(
        await page.evaluate(() => window.__gameDebug.getModel().selections[0].automatic),
        false,
      );
      await page.locator('.upgrade-feedback').waitFor();
      await localized(page, language.id, '.upgrade-feedback');
      await inspect(page);
      if (width === 375) await screenshot(page, `artifacts/screens/upgrade-${language.id}.png`);
      await page.evaluate(() => {
        window.__gameDebug.restart(96057);
        window.__gameDebug.advance(610000);
      });
      await page.getByRole('heading', { name: c.success, exact: true }).waitFor();
      await page.evaluate(() => {
        const game = window.__gameDebug.getModel();
        for (const id of Object.keys(game.ranks)) {
          if (game.rank(id)) game.rarities[id] = 'legendary';
        }
        window.__gameDebug.advance(0);
      });
      await localized(page, language.id, '.result');
      await inspect(page);
      await page.locator('.result summary').click();
      const counts = await page.evaluate(() => window.__gameDebug.getModel().result.counts);
      assert.deepEqual(
        await page.locator('.result tbody th').allTextContents(),
        particleIds.map((id) => particleNames[language.id][id]),
      );
      for (const id of particleIds) {
        const c = counts[id];
        assert.ok(c.generated > 0, 'Missing species: ' + id);
        assert.deepEqual(
          await page.locator(`.result tr[data-particle="${id}"] td`).allTextContents(),
          [c.generated, c.killed, c.absorbed, c.remaining].map(String),
        );
      }
      assert.equal(
        await page
          .locator('.result .dialog-body')
          .evaluate((n) => n.scrollWidth > n.clientWidth + 1),
        false,
        'Result details overflow',
      );
      if (width === 375) await screenshot(page, `artifacts/screens/result-${language.id}.png`);
      await page.getByRole('button', { name: c.retry, exact: true }).click();
      await page.evaluate((goal) => {
        window.__gameDebug.restart(1, false);
        window.__gameDebug.xp(goal - 1);
        const g = window.__gameDebug.getModel();
        g.mass = 1000;
        g.radius = g.core + 4;
        window.__gameDebug.advance(16000);
      }, rules.energyGoal);
      await page.getByRole('heading', { name: c.failure, exact: true }).waitFor();
      await inspect(page);
      await page.getByRole('button', { name: c.newRun, exact: true }).click();
      await page.reload();
      await page.getByRole('button', { name: language.label, exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: language.label, exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      await page.close();
      checks.push({ language: language.id, viewport: [width, height], flow: 'passed' });
      console.log('PASS', language.id, width, height);
    }
    if (language.id === 'ko') continue;
    for (const [width, height] of [
      [320, 568],
      [568, 320],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base);
      await page.waitForFunction(() => !!window.__gameDebug);
      await page.getByRole('button', { name: language.label, exact: true }).click();
      const ids = upgradeIds;
      for (const rarity of rarityIds)
        for (let rank = 1; rank <= rules.maxRank; rank++)
          for (let i = 0; i < ids.length; i += 3) {
            await page.evaluate(
              ({ ids, rarity, rank }) => {
                window.__gameDebug.restart(1, false);
                const g = window.__gameDebug.getModel();
                for (const id of ids) {
                  if (id in g.ranks) g.ranks[id] = rank - 1;
                  else if (id === 'recover') g.mass = 120;
                  else g.boosts[id] = rank - 1;
                }
                g.choice = {
                  number: 1,
                  opened: 0,
                  deadline: 8,
                  cards: ids.map((id) => ({ id, rarity })),
                };
                window.__gameDebug.advance(0);
              },
              { ids: [0, 1, 2].map((n) => ids[(i + n) % ids.length]), rarity, rank },
            );
            await page.waitForTimeout(90);
            await inspect(page);
          }
      await page.close();
      checks.push({
        language: language.id,
        viewport: [width, height],
        cardVariants: ids.length * rules.maxRank * rarityIds.length,
      });
      console.log('PASS card variants', language.id, width, height);
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/languages.json', JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
