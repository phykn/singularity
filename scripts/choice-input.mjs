import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, capture, launchBrowser } from './browser-support.mjs';

mkdirSync('artifacts/choice-input', { recursive: true });
const browser = await launchBrowser();
const errors = [],
  checks = [];

async function layout(page) {
  return page.evaluate(() => {
    const bounds = (node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    return {
      arena: bounds(document.querySelector('.arena')),
      canvas: bounds(document.querySelector('.arena canvas')),
      footer: bounds(document.querySelector('.footer')),
      choices: [...document.querySelectorAll('.choices:not(.choice-receipt), .card')].map(bounds),
    };
  });
}

async function checkChoiceLayout(page) {
  await page.evaluate(() => {
    const d = window.__gameDebug;
    d.restart(421, false);
    const g = d.getModel();
    g.ranks.multi = 1;
    g.rarities.multi = 'common';
    d.advance(0);
  });
  await page.locator('.slot-inspect').waitFor();
  const inspectionLabel = await page.locator('.slot-inspect').getAttribute('aria-label');
  const before = await layout(page);
  await page.evaluate(() => window.__gameDebug.xp(14));
  await page.locator('.cards[data-ready="true"]').waitFor();
  const offered = await layout(page);
  assert.deepEqual(offered.arena, before.arena, 'Choices must not move or resize the arena');
  assert.deepEqual(offered.canvas, before.canvas, 'Choices must preserve the rendered orbit');
  assert.equal(await page.locator('.play-footer').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: inspectionLabel, exact: true }).count(), 0);
  for (const r of offered.choices) {
    assert.ok(
      r.left >= offered.footer.left &&
        r.top >= offered.footer.top &&
        r.right <= offered.footer.right &&
        r.bottom <= offered.footer.bottom,
      'Choice cards must fit inside the fixed footer',
    );
    assert.ok(
      r.top >= offered.arena.bottom || r.left >= offered.arena.right,
      'Choice cards must not cover gameplay in portrait or landscape',
    );
  }
  await page.locator('.card').first().click();
  await page.locator('.choice-receipt').waitFor();
  assert.equal(await page.locator('.play-footer').isVisible(), false);
  assert.deepEqual((await layout(page)).arena, before.arena);
  await page.locator('.choice-receipt').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.play-footer').isVisible(), true);
  assert.equal(await page.locator('.slot-inspect').first().isVisible(), true);
  const restored = await layout(page);
  assert.deepEqual(restored.arena, before.arena);
  assert.deepEqual(restored.canvas, before.canvas);
  checks.push({ choiceLayout: 'fixed footer, no gameplay overlap, loadout restored', ...offered });
}

try {
  for (const [width, height] of process.argv.includes('--mouse-only')
    ? []
    : [
        [390, 844],
        [320, 568],
        [667, 280],
      ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await checkChoiceLayout(page);
    const touch = await page.context().newCDPSession(page);
    const send = (type, points) =>
      touch.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const tap = async (p) => {
      await send('touchStart', [p]);
      await send('touchEnd', []);
    };
    const selections = () => page.evaluate(() => window.__gameDebug.getModel().selections.length);
    const open = async (xp = 14) => {
      await page.evaluate((xp) => {
        const d = window.__gameDebug;
        d.restart(421, false);
        d.xp(xp);
      }, xp);
      await page.locator('.card').first().waitFor();
      const box = await page.locator('.card').first().boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
    };
    let p = await open();
    await tap(p);
    assert.equal(await selections(), 0, 'The touch burst that opens choices must not pick a card');
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(100);
      await tap(p);
      assert.equal(await selections(), 0);
    }
    await page.locator('.cards[data-ready="true"]').waitFor();
    await tap(p);
    assert.equal(await selections(), 1, 'One fresh tap after a quiet interval must select once');
    checks.push({ rapidBurst: 'blocked beyond 450 ms', freshSingleTap: 'selected once' });

    p = await open();
    await send('touchStart', [p]);
    await page.waitForTimeout(650);
    await send('touchEnd', []);
    assert.equal(await selections(), 0, 'A held touch that started protected must remain rejected');
    await page.locator('.cards[data-ready="true"]').waitFor();
    await tap(p);
    assert.equal(await selections(), 1);
    checks.push({ heldTouch: 'rejected', nextSingleTap: 'selected once' });

    p = await open(100);
    await page.locator('.cards[data-ready="true"]').waitFor();
    await tap(p);
    assert.equal(await selections(), 1);
    const second = await page.locator('.card').first().boundingBox();
    await tap({ x: second.x + second.width / 2, y: second.y + second.height / 2, id: 1 });
    assert.equal(await selections(), 1, 'A second queued choice must have its own protection');
    await page.locator('.cards[data-ready="true"]').waitFor();
    await page.locator('.card').first().tap();
    assert.equal(await selections(), 2);
    checks.push({ queuedChoices: 'protected separately' });

    await page.evaluate(() => window.__gameDebug.restart(421, false));
    const arena = await page.locator('.arena').boundingBox();
    await send('touchStart', [{ x: arena.x + 30, y: arena.y + 50, id: 1 }]);
    await page.evaluate(() => window.__gameDebug.xp(14));
    await page.locator('.card').first().waitFor();
    const moved = await page.locator('.card').first().boundingBox();
    p = { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2, id: 1 };
    await send('touchMove', [p]);
    await page.waitForTimeout(500);
    await send('touchEnd', []);
    assert.equal(
      await selections(),
      0,
      'A gameplay gesture must not finish on a newly appeared card',
    );
    await page.locator('.cards[data-ready="true"]').waitFor();
    await tap(p);
    assert.equal(await selections(), 1);
    checks.push({ gameplayCarryover: 'rejected', viewport: [width, height] });

    p = await open();
    await page.locator('.cards[data-ready="true"]').waitFor();
    const other = await page.locator('.card').nth(1).boundingBox();
    const q = { x: other.x + other.width / 2, y: other.y + other.height / 2, id: 2 };
    await send('touchStart', [p]);
    await send('touchMove', [{ ...q, id: 1 }]);
    await send('touchEnd', []);
    assert.equal(await selections(), 0, 'Dragging between cards must not select either');
    await page.locator('.cards[data-ready="true"]').waitFor();
    await send('touchStart', [p]);
    await send('touchStart', [p, q]);
    await send('touchEnd', []);
    assert.equal(await selections(), 0, 'A multitouch gesture must not select a card');
    await page.locator('.cards[data-ready="true"]').waitFor();
    await tap(p);
    assert.equal(await selections(), 1);
    checks.push({ drag: 'rejected', multitouch: 'rejected' });

    p = await open();
    await page.locator('.choice-pause').click();
    const remaining = await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      return g.choice.deadline - g.time;
    });
    await page.waitForTimeout(200);
    assert.ok(
      (await page.evaluate(() => {
        const g = window.__gameDebug.getModel();
        return g.choice.deadline - g.time;
      })) < remaining,
    );
    await page.locator('.cards[data-ready="true"]').waitFor();
    await tap(p);
    assert.equal(await selections(), 1);
    checks.push({ runningChoice: 'wall-time guard with unchanged countdown' });

    await open();
    await page.keyboard.press('Enter');
    assert.equal(await selections(), 1, 'Keyboard selection keeps one-activation behavior');
    await open();
    await page
      .locator('.card')
      .first()
      .evaluate((node) => node.click());
    assert.equal(
      await selections(),
      1,
      'Assistive/programmatic activation is not mistaken for a pointer burst',
    );
    checks.push({ keyboard: 'one activation', assistive: 'one activation' });
    await open();
    await page.locator('.choice-receipt').waitFor({ state: 'hidden' });
    await capture(page, `artifacts/choice-input/appearance-${width}.png`);
    await page.locator('.cards[data-ready="true"]').waitFor();
    await capture(page, `artifacts/choice-input/ready-${width}.png`);
    await page.close();
  }
  const mouse = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  mouse.on('pageerror', (e) => errors.push(e.message));
  await mouse.goto(base);
  await mouse.getByRole('button', { name: 'START', exact: true }).click();
  await checkChoiceLayout(mouse);
  await mouse.evaluate(() => {
    const d = window.__gameDebug;
    d.restart(421, false);
    d.xp(14);
  });
  await mouse.locator('.card').first().click();
  assert.equal(await mouse.evaluate(() => window.__gameDebug.getModel().selections.length), 0);
  await mouse.locator('.cards[data-ready="true"]').waitFor();
  await mouse.locator('.card').first().click();
  assert.equal(await mouse.evaluate(() => window.__gameDebug.getModel().selections.length), 1);
  checks.push({ mouse: 'appearance guard then single click' });
  await mouse.evaluate(() => {
    const d = window.__gameDebug;
    d.restart(421, false);
    d.xp(14);
  });
  await mouse.locator('.cards[data-ready="true"]').waitFor();
  const held = await mouse.locator('.card').first().boundingBox();
  await mouse.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
  await mouse.mouse.down();
  await mouse.keyboard.press('Escape');
  await mouse.locator('#pause-title').waitFor();
  await mouse.keyboard.press('Escape');
  await mouse.locator('#pause-title').waitFor({ state: 'hidden' });
  await mouse.mouse.up();
  assert.equal(
    await mouse.evaluate(() => window.__gameDebug.getModel().selections.length),
    0,
    'An interrupted press must not select a card after resuming',
  );
  await mouse.locator('.cards[data-ready="true"]').waitFor();
  await mouse.locator('.card').first().click();
  assert.equal(await mouse.evaluate(() => window.__gameDebug.getModel().selections.length), 1);
  checks.push({ pauseCarryover: 'rejected', freshClickAfterResume: 'selected once' });
  await mouse.close();
  assert.deepEqual(errors, []);
  writeFileSync(
    `artifacts/choice-input/${process.argv.includes('--mouse-only') ? 'mouse-checks' : 'checks'}.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
}
