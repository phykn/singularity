import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { base, capture, launchBrowser } from './browser-support.mjs';
import { copy, languages } from '../src/ui/i18n.ts';
import { skillIds, rules } from '../src/game/rules.ts';
import { skillValue } from '../src/ui/skillText.ts';

const browser = await launchBrowser();
const checks = [],
  errors = [];
const inspectDialog = async (page) => {
  const issues = await page.getByRole('dialog').evaluate((dialog) => {
    const issues = [];
    for (const node of dialog.querySelectorAll('button, h2, .language-picker, .skill-value')) {
      const r = node.getBoundingClientRect();
      if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight)
        issues.push('Offscreen: ' + node.textContent);
      if (node.scrollWidth > node.clientWidth + 1) issues.push('Overflow: ' + node.textContent);
      if (node.tagName === 'BUTTON') {
        if (r.width < 44 || r.height < 44) issues.push('Small target: ' + node.textContent);
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (!node.contains(top)) issues.push('Covered: ' + node.textContent);
      }
    }
    return issues;
  });
  assert.deepEqual(issues, []);
};
const snapshot = (page) =>
  page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    return {
      tick: g.tick,
      angle: g.angle,
      selections: g.selections.length,
      choice: g.choice,
      effects: g.effects,
      radius: g.radius,
      mass: g.mass,
    };
  });
try {
  for (const { id: language, label } of languages) {
    const c = copy[language];
    for (const [width, height] of [
      [320, 568],
      [568, 320],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        isMobile: true,
        hasTouch: true,
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base);
      await page.getByRole('button', { name: label, exact: true }).tap();
      await page.getByRole('button', { name: c.guide, exact: true }).tap();
      assert.equal(await page.locator('.skill-guide details[open]').count(), 0);
      const entry = page
        .locator('.skill-guide details')
        .filter({ has: page.locator('summary', { hasText: c.upgrades.satellite.name }) });
      await entry.locator('summary').tap();
      assert.equal(await entry.getAttribute('open'), '');
      assert.equal(await entry.locator('.guide-rank').count(), 5);
      await capture(page, `artifacts/ui/guide-${language}-${width}.png`);
      await page.getByRole('button', { name: c.close, exact: true }).tap();
      await page.getByRole('button', { name: 'START', exact: true }).tap();
      // Use real choices to acquire each skill, then inspect through the touch dock.
      for (const [index, id] of skillIds.entries()) {
        await page.evaluate(
          ({ id, index }) => {
            const d = window.__gameDebug;
            d.restart(770 + index, false);
            const g = d.getModel();
            g.nextSpawn = Infinity;
            g.choice = {
              number: 1,
              opened: g.time,
              deadline: g.time + g.rules.choiceSeconds,
              cards: [{ id, rarity: 'epic' }],
            };
            d.advance(0);
          },
          { id, index },
        );
        await page.locator(`.card[data-upgrade="${id}"]`).tap();
        const button = page.getByRole('button', {
          name: c.upgrades[id].name + ' · ' + c.skillDetails,
          exact: true,
        });
        await button.tap();
        await page.getByRole('heading', { name: c.upgrades[id].name, exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 1);
        assert.equal(await page.locator('.skill-rarity').innerText(), c.rarities.epic);
        assert.equal(
          await page
            .locator('.skill-details')
            .getByRole('img', { name: `${c.rank} 1/${rules.maxRank}`, exact: true })
            .count(),
          1,
        );
        assert.equal(
          await page.locator('.skill-value').innerText(),
          skillValue(id, 1, 'epic', language, rules),
        );
        await inspectDialog(page);
        if (id === 'satellite') {
          await capture(page, `artifacts/ui/skill-${language}-${width}.png`);
          const before = await snapshot(page);
          await page.waitForTimeout(180);
          assert.deepEqual(await snapshot(page), before, 'Inspecting a skill must freeze combat');
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement?.textContent), c.close);
          await page.keyboard.press('Escape');
        } else await page.getByRole('button', { name: c.close, exact: true }).tap();
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await page.evaluate(() => window.__gameDebug.getModel().manualPaused), false);
      }
      // Short landscape uses the dock space for cards; HUD pause remains available.
      await page.evaluate(() => window.__gameDebug.xp(100));
      await page.locator('.choice-pause').tap();
      if (height > 320) await page.locator('.slot-inspect').first().tap();
      else await page.getByRole('button', { name: c.pause, exact: true }).tap();
      const frozen = await snapshot(page);
      await page.waitForTimeout(200);
      assert.deepEqual(await snapshot(page), frozen);
      await page
        .getByRole('button', { name: height > 320 ? c.close : c.resume, exact: true })
        .tap();
      const remaining = await page.evaluate(() => {
        const g = window.__gameDebug.getModel();
        return g.choice.deadline - g.time;
      });
      assert.ok(remaining <= frozen.choice.deadline - frozen.tick / rules.tickRate);
      assert.ok(remaining > 0, 'Closing inspection must not consume the whole choice');
      await page.getByRole('button', { name: c.pause, exact: true }).tap();
      await inspectDialog(page);
      await capture(page, `artifacts/ui/pause-${language}-${width}.png`);
      const sound = page.locator('.setting-row');
      await sound.tap();
      await sound.tap();
      for (const lang of languages)
        await page.getByRole('button', { name: lang.label, exact: true }).tap();
      await page.getByRole('button', { name: label, exact: true }).tap();
      await page.getByRole('button', { name: c.quit, exact: true }).tap();
      await inspectDialog(page);
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), c.back);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#pause-title').innerText(), c.pause);
      assert.equal(await page.evaluate(() => window.__gameDebug.getModel().manualPaused), true);
      await page.getByRole('button', { name: c.resume, exact: true }).tap();
      checks.push({
        language,
        width,
        height,
        skills: skillIds.length,
        pausedInspection: true,
        reachablePauseControls: true,
        safeQuitFocus: true,
      });
      console.log('PASS UI', language, width, height);
      await page.close();
    }
  }
  // Browser chrome can leave a phone's landscape viewport shorter than 320px.
  for (const { id: language, label } of languages) {
    const c = copy[language];
    const page = await browser.newPage({
      viewport: { width: 667, height: 280 },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: label, exact: true }).tap();
    await page.getByRole('button', { name: 'START', exact: true }).tap();
    await page.evaluate(() => window.__gameDebug.xp(14));
    await page.locator('.card').first().waitFor();
    const pause = page.getByRole('button', { name: c.pause, exact: true });
    const box = await pause.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('#pause-title').waitFor();
    assert.equal(await page.locator('.choice-pause').getAttribute('aria-checked'), 'true');
    await page.getByRole('button', { name: c.resume, exact: true }).tap();
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.choices');
      const choices = panel.getBoundingClientRect();
      const hud = document.querySelector('.hud').getBoundingClientRect();
      const contents = [...panel.querySelectorAll('.choice-header, .card')].map((node) => {
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      return {
        choicesTop: choices.top,
        choicesBottom: choices.bottom,
        hudBottom: hud.bottom,
        clipped: panel.scrollHeight > panel.clientHeight,
        contents,
      };
    });
    assert.ok(layout.choicesTop >= layout.hudBottom, 'Choice cards cannot cover HUD controls');
    assert.equal(
      layout.clipped,
      false,
      'All card values must be readable without hiding the timer',
    );
    assert.ok(
      layout.contents.every((r) => r.top >= layout.choicesTop && r.bottom <= layout.choicesBottom),
    );
    await capture(page, `artifacts/ui/short-choice-${language}.png`);
    await page.locator('.card').first().tap();
    await page.locator('.slot-inspect').first().tap();
    await page.getByRole('button', { name: c.close, exact: true }).tap();
    checks.push({ language, width: 667, height: 280, reachablePauseControls: true });
    await capture(page, `artifacts/ui/short-${language}.png`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/ui.json', JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
