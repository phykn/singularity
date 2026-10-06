import assert from 'node:assert/strict';
import { base, launchBrowser, observeScene, capture } from './browser-support.mjs';

const browser = await launchBrowser();
const errors = [];
try {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 568, height: 320 },
  ]) {
    const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
    page.on('pageerror', (error) => errors.push(error.message));
    await observeScene(page);
    await page.goto(base);
    await page.waitForFunction(() => window.__gameDebug && window.__gameScene);
    await page.evaluate(() => document.fonts.ready);
    await capture(page, `artifacts/presentation-after/title-${viewport.width}.png`);
    const labels = await page.evaluate(() => {
      const debug = window.__gameDebug;
      debug.restart(421, false);
      const game = debug.getModel();
      game.setHidden(true);
      const scene = window.__gameScene;
      const hit = (id, value) => ({
        id,
        value,
        born: game.seconds,
        x: 180,
        y: 260,
        rarity: 'common',
      });
      game.damageNumbers = [hit(100, 17.4)];
      scene.update();
      const original = scene.damageLabels.labels.get(100);
      const before = { x: original.x, y: original.y };
      game.damageNumbers.push(hit(101, 29.8), { ...hit(102, 43.1), x: 235 });
      scene.update();
      const after = { x: original.x, y: original.y };
      const visible = scene.damageLabels.texts.filter((text) => text.visible);
      const values = visible.map((text) => text.text);
      const count = scene.damageLabels.texts.length;
      let visibilityChanges = 0;
      const originalVisibility = new Map();
      for (const text of scene.damageLabels.texts) {
        const original = text.setVisible.bind(text);
        originalVisibility.set(text, original);
        text.setVisible = (value) => {
          if (text.visible !== value) visibilityChanges++;
          return original(value);
        };
      }
      for (let i = 0; i < 120; i++) scene.update();
      for (const [text, original] of originalVisibility) text.setVisible = original;
      const stablePool = scene.damageLabels.texts.length === count;
      game.damageNumbers = [];
      scene.update();
      const cleared = scene.damageLabels.texts.every((text) => !text.visible);
      return { before, after, values, stablePool, cleared, visibilityChanges };
    });
    assert.deepEqual(
      labels.after,
      labels.before,
      'New hits must not move an existing damage label',
    );
    assert.ok(labels.values.includes('17') && labels.values.includes('43'));
    assert.ok(
      labels.values.every((value) => /^\d+$/.test(value)),
      'Damage stays visible as integers',
    );
    assert.ok(
      labels.stablePool && labels.cleared,
      'Labels reuse their pool and disappear when expired',
    );
    assert.equal(labels.visibilityChanges, 0, 'Stable hits must not hide and show every frame');
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      const offset = await page.evaluate(() => {
        const debug = window.__gameDebug;
        debug.restart(422, false);
        const game = debug.getModel();
        game.setHidden(true);
        game.effects = [
          {
            kind: 'strike',
            source: 'strike',
            from: { x: 180, y: 220 },
            to: { x: 180, y: 260 },
            born: game.seconds,
            life: 0.3,
            radius: 10,
            width: 1,
            damage: game.damage * game.forms.strike.damage,
            rank: 1,
            rarity: 'common',
          },
        ];
        window.__gameScene.update();
        return window.__gameScene.offset;
      });
      if (reducedMotion === 'reduce') assert.deepEqual(offset, { x: 0, y: 0 });
      else assert.notEqual(offset.x, 0, 'Default play keeps heavy-hit feedback');
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const seconds of [20, 350, 460, 469, 470]) {
      await page.evaluate((seconds) => {
        const debug = window.__gameDebug;
        debug.restart(95008);
        debug.advance(seconds * 1000);
        debug.getModel().setHidden(true);
        window.__gameScene.update();
      }, seconds);
      await capture(page, `artifacts/presentation-after/play-${seconds}-${viewport.width}.png`);
    }
    console.log(
      `${viewport.width}×${viewport.height}: stable integer damage labels, pooled reuse, reduced-motion impacts, early/crowd/ending/result captures passed.`,
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
