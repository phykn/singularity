import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { base, capture, launchBrowser, observeScene } from './browser-support.mjs';
import { copy } from '../src/ui/i18n.ts';
import { languageKey } from '../src/app/storage.ts';

const browser = await launchBrowser();
const checks = [],
  errors = [];
try {
  for (const [width, height, language] of [
    [320, 568, 'zh'],
    [375, 812, 'ko'],
    [568, 320, 'en'],
    [812, 375, 'ja'],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      ({ key, language }) => localStorage.setItem(key, JSON.stringify(language)),
      { key: languageKey, language },
    );
    await observeScene(page);
    await page.goto(base);
    await page.waitForFunction(() => window.__gameDebug && window.__gameScene);
    await page.evaluate(() => document.fonts.ready);
    const collision = await page.evaluate(() => {
      const d = window.__gameDebug;
      d.restart(1703);
      const g = d.getModel();
      for (let i = 0; i < 4800 && g.phase === 'running'; i++) d.advance(125);
      g.setHidden(true);
      return { phase: g.phase, xp: g.xp, mass: g.mass, seconds: g.seconds, counts: g.counts };
    });
    assert.equal(collision.phase, 'collapse');
    if (language === 'ko') {
      for (const [name, phase, time] of [
        ['unstable', 'collapse', 0.1],
        ['spiral', 'collapse', 0.9],
        ['contact', 'collapse', 1.58],
        ['impact', 'ending', 0.05],
        ['empty', 'ending', 0.5],
      ]) {
        const state = await page.evaluate(
          ({ phase, time }) => {
            const d = window.__gameDebug,
              g = d.getModel();
            g.setHidden(false);
            if (g.phase !== phase)
              d.advance((g.rules.collisionSeconds - g.phaseTicks / g.rules.tickRate) * 1000);
            d.advance(Math.max(0, time * 1000 - (g.phaseTicks / g.rules.tickRate) * 1000));
            g.setHidden(true);
            window.__gameScene.update();
            return { phase: g.phase, xp: g.xp, mass: g.mass, counts: g.counts };
          },
          { phase, time },
        );
        assert.equal(state.phase, phase);
        assert.equal(state.xp, collision.xp);
        assert.equal(state.mass, collision.mass);
        assert.deepEqual(state.counts, collision.counts);
        await capture(page, `artifacts/collapse/${name}.png`);
      }
    }
    await page.evaluate(() => {
      const d = window.__gameDebug,
        g = d.getModel();
      g.setHidden(false);
      d.advance(5000);
      g.setHidden(true);
      window.__gameScene.update();
    });
    await page.locator('#result-title').waitFor();
    await page.waitForTimeout(650);
    const result = await page.evaluate(() => window.__gameDebug.getModel().result);
    assert.equal(result.outcome, 'collapse-failure');
    assert.equal(result.xp, collision.xp);
    assert.equal(await page.locator('#result-title').innerText(), copy[language].failure);
    assert.equal(await page.locator('.collapse-symbol').count(), 1);
    const bar = page.locator('.result').getByRole('progressbar');
    assert.equal(await bar.getAttribute('aria-valuenow'), String(result.xp));
    assert.equal(await bar.getAttribute('aria-valuemax'), '20000');
    assert.equal(await page.locator('.result-numbers > div').count(), 2);
    const issues = await page.evaluate(() => {
      const issues = [];
      if (
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight
      )
        issues.push('page overflow');
      for (const node of document.querySelectorAll(
        '.result-heading, .result-goal, .result-actions button',
      )) {
        const r = node.getBoundingClientRect();
        if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)
          issues.push('offscreen: ' + node.className);
        if (node.scrollWidth > node.clientWidth + 1) issues.push('clipped: ' + node.className);
      }
      return issues;
    });
    assert.deepEqual(issues, []);
    await capture(page, `artifacts/collapse/result-${language}.png`);
    await page.locator('.result summary').click();
    assert.equal(await page.locator('.result tbody tr').count(), Object.keys(result.counts).length);
    await page.getByRole('button', { name: copy[language].retry, exact: true }).tap();
    assert.equal(await page.evaluate(() => window.__gameDebug.getModel().phase), 'ready');
    assert.notEqual(await page.evaluate(() => window.__gameDebug.getModel().seed), result.seed);
    // A near-clear failure still communicates the exact missing point without a sentence.
    await page.evaluate(() => {
      const d = window.__gameDebug;
      d.restart(1703, false);
      const g = d.getModel();
      d.xp(19999);
      g.mass = 1000;
      g.radius = g.core + g.rules.electronRadius;
      d.advance(5000);
      g.setHidden(true);
      window.__gameScene.update();
    });
    await page.locator('#result-title').waitFor();
    await page.waitForTimeout(650);
    assert.equal(await bar.getAttribute('aria-valuenow'), '19999');
    assert.equal(
      await page.locator('.result-goal b').innerText(),
      new Intl.NumberFormat(language).format(19999),
    );
    await capture(page, `artifacts/collapse/near-goal-${language}.png`);
    checks.push({
      width,
      height,
      language,
      collision,
      result: { xp: result.xp, level: result.level, mass: result.mass },
      issues,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/collapse.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ cases: checks.length, nearGoalCases: checks.length, errors }));
} finally {
  await browser.close();
}
