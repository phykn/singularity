import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, capture, launchBrowser, observeScene } from './browser-support.mjs';
import { copy } from '../src/ui/i18n.ts';

mkdirSync('artifacts/rhythm', { recursive: true });
const browser = await launchBrowser();
const errors = [],
  checks = [];
async function tap(page) {
  const box = await page.locator('.arena').boundingBox();
  await page.touchscreen.tap(box.x + 28, box.y + 48);
}
async function beat(page, n, key) {
  const box = await page.locator('.arena').boundingBox();
  await page.waitForFunction(
    (n) => {
      const r = window.__gameDebug.getRhythm();
      const g = window.__gameDebug.getModel();
      const delta = Math.atan2(Math.sin(g.angle - r.gateAngle), Math.cos(g.angle - r.gateAngle));
      // Use the visible electron crossing, never the scheduler's internal due time.
      return r.active && r.hits === n && Math.abs(delta) < r.windowAngle * 0.4;
    },
    n,
    { polling: 'raf', timeout: 20000 },
  );
  if (key) await page.keyboard.press(key);
  else await page.touchscreen.tap(box.x + 28, box.y + 48);
  const state = await page.evaluate(() => {
    const r = window.__gameDebug.getRhythm();
    return { hits: r.hits, age: r.age, due: r.due, feedback: r.feedback, active: r.active };
  });
  assert.equal(state.hits, n + 1, JSON.stringify(state));
}
async function prepare(page, language) {
  await page.evaluate(
    (language) => localStorage.setItem('singularity.language', JSON.stringify(language)),
    language,
  );
  await page.reload();
  await page.waitForFunction(() => !!window.__gameDebug);
  await page.getByRole('button', { name: 'START', exact: true }).waitFor();
  await page.evaluate(() => {
    const d = window.__gameDebug;
    d.restart(421, false);
    const g = d.getModel();
    g.targets = Array.from({ length: 12 }, (_, i) => {
      const angle = (i * Math.PI) / 6;
      return {
        id: i + 1000,
        x: 180 + Math.cos(angle) * 145,
        y: 260 + Math.sin(angle) * 145,
        angle,
        radius: 145,
        hp: 1000,
        maxHp: 1000,
        kind: 'small',
        particle: 'quark',
        born: 0,
        xp: 1,
        mass: 1,
        size: 8,
        speed: 0,
        turn: 0,
      };
    });
    g.counts.quark.generated = 12;
  });
}
try {
  for (const [width, height, language, speed] of process.argv.includes('--input-only')
    ? []
    : [
        [390, 844, 'ko', 1],
        [667, 280, 'en', 2],
        [320, 568, 'ja', 1.5],
      ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await prepare(page, language);
    for (let i = 0; i < (speed === 2 ? 2 : speed === 1.5 ? 1 : 0); i++)
      await page
        .getByRole('button', { name: new RegExp('^' + copy[language].playbackSpeed) })
        .click();
    await page.waitForSelector('.rhythm-input');
    await capture(page, `artifacts/rhythm/ready-${width}.png`);
    await beat(page, 0);
    await beat(page, 1);
    await beat(page, 2);
    const result = await page.evaluate(() => {
      const d = window.__gameDebug,
        g = d.getModel(),
        r = d.getRhythm();
      return {
        completed: r.completed,
        inputs: g.resonances.length,
        hits: g.events.filter((e) => e.kind === 'hit').length,
        labels: g.damageNumbers.map((n) => n.value),
        phase: g.phase,
        allHit: g.targets.every((t) => t.hp < t.maxHp),
      };
    });
    assert.equal(result.completed, 1);
    assert.equal(result.inputs, 3);
    assert.ok(result.hits > 0, 'The completed phrase must deal actual damage');
    assert.equal(result.allHit, true, 'The final discharge must reach all particles');
    await capture(page, `artifacts/rhythm/complete-${width}.png`);
    // Holding/releasing and the compatibility click must not create another input.
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__gameDebug.getModel().resonances.length), 3);
    checks.push({ viewport: [width, height], language, speed, ...result });

    await prepare(page, language);
    await page.waitForSelector('.rhythm-input');
    await beat(page, 0);
    if (width === 390) await capture(page, 'artifacts/rhythm/hit.png');
    await page.waitForFunction(() => window.__gameDebug.getRhythm().feedback === 'miss');
    if (width === 390) await capture(page, 'artifacts/rhythm/miss.png');
    assert.equal(await page.evaluate(() => window.__gameDebug.getModel().resonances.length), 1);

    await prepare(page, language);
    await page.waitForSelector('.rhythm-input');
    await page.getByRole('button', { name: copy[language].pause, exact: true }).click();
    assert.equal(await page.locator('.rhythm-input').count(), 0);
    assert.equal(await page.evaluate(() => window.__gameDebug.getRhythm().feedback), null);
    await page.getByRole('button', { name: copy[language].resume, exact: true }).click();
    await page.waitForSelector('.rhythm-input');
    await page.evaluate(() => window.__gameDebug.xp(14));
    await page.locator('.choices').waitFor();
    assert.equal(await page.locator('.rhythm-input').count(), 0);
    await page.locator('.choice-pause').click();
    await tap(page);
    assert.equal(await page.evaluate(() => window.__gameDebug.getModel().resonances.length), 0);
    await page.locator('.cards[data-ready="true"]').waitFor();
    await page.locator('.card').first().click();
    await page.waitForSelector('.rhythm-input');
    const resumed = await page.evaluate(() => {
      const r = window.__gameDebug.getRhythm();
      return { hits: r.hits, active: r.active, remaining: r.due - r.age };
    });
    assert.ok(
      resumed.active && resumed.hits === 0 && resumed.remaining > 0,
      JSON.stringify(resumed),
    );
    checks.push({
      viewport: [width, height],
      partialReward: 'retained after miss',
      ui: 'isolated',
      resume: 'fresh phrase',
    });
    await page.close();
  }
  const fast = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  fast.on('pageerror', (e) => errors.push(e.message));
  await fast.goto(base);
  await prepare(fast, 'ko');
  await fast.evaluate(() => {
    const g = window.__gameDebug.getModel();
    g.mass = 100;
    g.radius = 67;
    g.boosts.speed = 25;
  });
  for (let i = 0; i < 2; i++)
    await fast.getByRole('button', { name: new RegExp('^' + copy.ko.playbackSpeed) }).click();
  await fast.waitForSelector('.rhythm-input');
  await capture(fast, 'artifacts/rhythm/fast-electron.png');
  for (let n = 0; n < 3; n++) await beat(fast, n);
  assert.equal(await fast.evaluate(() => window.__gameDebug.getRhythm().completed), 1);
  await capture(fast, 'artifacts/rhythm/fast-complete.png');
  checks.push({ fastOrbit: 'visible electron crossings complete all three beats at 2x' });
  await fast.close();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await observeScene(page);
  await page.goto(base);
  await prepare(page, 'zh');
  await page.waitForSelector('.rhythm-input');
  await page.getByRole('button', { name: copy.zh.pause, exact: true }).click();
  await page.getByRole('button', { name: copy.zh.resume, exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('arena')), true);
  await page.waitForSelector('.rhythm-input');
  await page.locator('.rhythm-input').dispatchEvent('pointerdown', {
    pointerType: 'touch',
    isPrimary: false,
    button: 0,
  });
  assert.equal(await page.evaluate(() => window.__gameDebug.getRhythm().feedback), null);
  await beat(page, 0, 'Space');
  await page.locator('.rhythm-input').dispatchEvent('keydown', { code: 'Space', repeat: true });
  assert.equal(await page.evaluate(() => window.__gameDebug.getRhythm().hits), 1);
  await beat(page, 1, 'Enter');
  await beat(page, 2, 'Space');
  await capture(page, 'artifacts/rhythm/reduced-complete.png');
  assert.equal(await page.evaluate(() => window.__gameDebug.getModel().resonances.length), 3);
  await prepare(page, 'zh');
  await page.waitForSelector('.rhythm-input');
  await page.getByRole('button', { name: copy.zh.pause, exact: true }).focus();
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.__gameDebug.getModel().manualPaused), true);
  assert.equal(await page.evaluate(() => window.__gameDebug.getModel().resonances.length), 0);
  await prepare(page, 'zh');
  await page.evaluate(() => {
    const d = window.__gameDebug;
    d.getModel().ranks.chain = 1;
    d.advance(0);
  });
  await page.locator('.slot-inspect').first().click();
  await page.getByRole('button', { name: copy.zh.close, exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('arena')), true);
  await beat(page, 0, 'Space');
  assert.equal(await page.evaluate(() => window.__gameDebug.getModel().manualPaused), false);
  await prepare(page, 'zh');
  await beat(page, 0, 'Space');
  await beat(page, 1, 'Enter');
  await page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    g.rules = { ...g.rules, energyGoal: 1 };
    g.targets[0].hp = 1;
  });
  await beat(page, 2, 'Space');
  const chargedFeedback = await page.evaluate(() => {
    const g = window.__gameDebug.getModel(),
      r = window.__gameDebug.getRhythm();
    const scene = window.__gameScene,
      graphics = scene.effects.graphics;
    let markers = 0;
    const lineStyle = graphics.lineStyle;
    graphics.lineStyle = function (width, color, ...args) {
      if (color === 0x91ffe2) markers++;
      return lineStyle.call(this, width, color, ...args);
    };
    try {
      scene.update();
    } finally {
      graphics.lineStyle = lineStyle;
    }
    return { charged: g.charged, feedback: r.feedback, feedbackAge: r.feedbackAge, markers };
  });
  assert.equal(chargedFeedback.charged, true);
  assert.equal(chargedFeedback.feedback, 'complete');
  assert.ok(chargedFeedback.feedbackAge < 650);
  assert.equal(chargedFeedback.markers, 1, 'XP completion must still render QTE success feedback');
  await capture(page, 'artifacts/rhythm/charged-complete.png');
  checks.push({
    keyboard: 'Space and Enter complete once',
    secondaryTouch: 'ignored',
    repeat: 'ignored',
    focusedControls: 'retain keyboard input',
    resumeFocus: 'pause and skill inspection return keyboard input to gameplay',
    chargedFeedback,
  });
  await page.close();
  assert.deepEqual(errors, []);
  writeFileSync(
    `artifacts/rhythm/${process.argv.includes('--input-only') ? 'input' : 'checks'}.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
