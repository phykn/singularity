import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, launchBrowser, observeScene, capture, showSuccess } from './browser-support.mjs';
import { copy } from '../src/ui/i18n.ts';
import { GOLD, WHITE } from '../src/art/palette.ts';
import { languageKey, recordKey, beyondRecordKey } from '../src/app/storage.ts';

const browser = await launchBrowser();
const rows = [],
  errors = [];
const cases = [
  { width: 375, height: 812, language: 'ko', motion: 'no-preference' },
  { width: 568, height: 320, language: 'en', motion: 'no-preference' },
  { width: 320, height: 568, language: 'zh', motion: 'reduce' },
  { width: 812, height: 375, language: 'ja', motion: 'no-preference' },
];
function diskDrawing() {
  const scene = window.__gameScene,
    graphics = scene.graphics;
  const keys = ['fillStyle', 'lineStyle', 'fillCircle', 'lineBetween', 'fillRect'];
  const originals = Object.fromEntries(keys.map((key) => [key, graphics[key]]));
  const commands = [];
  for (const key of keys)
    graphics[key] = function (...args) {
      commands.push([key, ...args]);
      return originals[key].apply(this, args);
    };
  try {
    scene.update();
  } finally {
    Object.assign(graphics, originals);
  }
  return commands;
}
try {
  for (const { width, height, language, motion } of cases) {
    const c = copy[language];
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
      reducedMotion: motion,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      ({ key, language }) => localStorage.setItem(key, JSON.stringify(language)),
      { key: languageKey, language },
    );
    await observeScene(page);
    await page.goto(base);
    await page.waitForFunction(() => !!window.__gameDebug && !!window.__gameScene);
    await page.evaluate(() => document.fonts.ready);
    await showSuccess(page);
    // The result fixture disables spawns; Beyond must exercise live combat again.
    await page.evaluate(() => {
      window.__gameDebug.getModel().combatEnabled = true;
    });
    await page.getByRole('heading', { name: c.success, exact: true }).waitFor();
    const original = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), recordKey);
    assert.equal(original?.outcome, 'success');
    await page.getByRole('button', { name: c.beyond, exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.result button.primary').disabled);
    await capture(page, `artifacts/beyond/result-${language}.png`);
    const settledDisk = await page.evaluate(diskDrawing);
    const button = page.getByRole('button', { name: c.beyond, exact: true });
    await page.evaluate(() => {
      window.addEventListener(
        'click',
        () => {
          const game = window.__gameDebug.getModel();
          if (game.phase === 'crossing') game.setHidden(true);
        },
        { once: true },
      );
    });
    if (language === 'en') {
      assert.equal(await button.evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press('Enter');
    } else await button.tap();
    const initial = await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      g.setHidden(true);
      return { at: g.continuedAt, xp: g.xp, ranks: g.ranks, rarities: g.rarities, phase: g.phase };
    });
    assert.equal(initial.phase, 'crossing');
    if (motion !== 'reduce')
      assert.deepEqual(
        await page.evaluate(diskDrawing),
        settledDisk,
        'The result and the first crossing frame must draw the same singularity',
      );
    assert.equal(await page.evaluate(() => window.__gameDebug.getModel().continueBeyond()), false);
    const pose = async (seconds) =>
      page.evaluate((seconds) => {
        const debug = window.__gameDebug,
          g = debug.getModel();
        g.setHidden(false);
        debug.advance(seconds * 1000 - (g.phaseTicks / g.rules.tickRate) * 1000);
        g.setHidden(true);
        window.__gameScene.update();
        return {
          phase: g.phase,
          entry: g.phaseTicks,
          seconds: g.endlessSeconds,
          targets: g.targets.length,
        };
      }, seconds);
    const contraction = [];
    for (const seconds of [0.05, 0.2, 0.25, 0.55, 0.75, 0.8, 0.9]) {
      await pose(seconds);
      if (seconds < 0.2) {
        await page.waitForFunction((seconds) => {
          const result = document.querySelector('.result');
          return (
            result &&
            Math.abs(
              Number(result.parentElement.parentElement.style.opacity) - (1 - seconds / 0.2),
            ) < 1e-8
          );
        }, seconds);
      } else {
        await page.locator('.result').waitFor({ state: 'hidden' });
      }
      const drawing = await page.evaluate(
        ({ gold, white }) => {
          const scene = window.__gameScene,
            graphics = scene.graphics;
          const originals = Object.fromEntries(
            ['fillStyle', 'lineStyle', 'fillCircle', 'strokeCircle', 'fillRect'].map((key) => [
              key,
              graphics[key],
            ]),
          );
          const colors = [],
            disks = [],
            rings = [],
            points = [];
          let ink;
          graphics.fillStyle = function (color, ...args) {
            ink = color;
            colors.push(color);
            return originals.fillStyle.call(this, color, ...args);
          };
          graphics.lineStyle = function (width, color, ...args) {
            colors.push(color);
            return originals.lineStyle.call(this, width, color, ...args);
          };
          graphics.fillCircle = function (x, y, r, ...args) {
            disks.push(r);
            return originals.fillCircle.call(this, x, y, r, ...args);
          };
          graphics.strokeCircle = function (x, y, r, ...args) {
            rings.push(r);
            return originals.strokeCircle.call(this, x, y, r, ...args);
          };
          graphics.fillRect = function (x, y, width, height, ...args) {
            if (ink === white)
              points.push({
                x,
                y,
                width: width * scene.worldScale,
                height: height * scene.worldScale,
              });
            return originals.fillRect.call(this, x, y, width, height, ...args);
          };
          try {
            scene.update();
          } finally {
            for (const [key, method] of Object.entries(originals)) graphics[key] = method;
          }
          return { gold: colors.includes(gold), disks, rings, points };
        },
        { gold: GOLD, white: WHITE },
      );
      assert.equal(
        drawing.gold,
        false,
        'No yellow circle between the singularity and the new orbit',
      );
      assert.deepEqual(drawing.rings, []);
      if (seconds >= 0.75 || motion === 'reduce') assert.deepEqual(drawing.disks, []);
      if (seconds >= 0.75) {
        assert.equal(drawing.points.length, 1);
        assert.ok(Math.abs(drawing.points[0].width - 3) < 1e-8);
        assert.ok(Math.abs(drawing.points[0].height - 3) < 1e-8);
      }
      if (seconds <= 0.2 && motion !== 'reduce') {
        const scale = await page.evaluate(() => window.__gameScene.worldScale);
        assert.ok(
          Math.abs(drawing.disks[0] - 24) <= 0.5 / scale,
          'Hold the singularity until the result is gone',
        );
      }
      contraction.push({ seconds, ...drawing });
      if (language === 'ko') await capture(page, `artifacts/beyond/entry-contract-${seconds}.png`);
    }
    const quiet = await pose(0.8);
    assert.equal(quiet.targets, 0);
    assert.equal(quiet.seconds, 0);
    await page.waitForFunction(
      () => Number(getComputedStyle(document.querySelector('.hud')).opacity) === 0.22,
    );
    assert.equal(await page.locator('.result').count(), 0);
    if (language === 'ko') await capture(page, 'artifacts/beyond/entry-quiet.png');
    await pose(1.2);
    const dust = await page.evaluate(() => {
      const scene = window.__gameScene,
        graphics = scene.graphics,
        original = graphics.fillRect;
      const points = [];
      graphics.fillRect = function (x, y, width, height, ...args) {
        if (
          Math.abs(width * scene.worldScale - 2) < 1e-8 &&
          Math.abs(height * scene.worldScale - 2) < 1e-8
        )
          points.push({ x, y });
        return original.call(this, x, y, width, height, ...args);
      };
      try {
        scene.update();
      } finally {
        graphics.fillRect = original;
      }
      return { points, radius: window.__gameDebug.getModel().rules.orbitRadius };
    });
    assert.equal(dust.points.length, 6, 'The opening keeps only six small particles');
    if (motion !== 'reduce') {
      const radius = dust.radius * (1 - (1 - 0.2) ** 3);
      for (const point of dust.points)
        assert.ok(
          Math.abs(Math.hypot(point.x - 180, point.y - 260) - radius * 1.08) < radius * 0.05 + 2,
        );
    }
    await capture(page, `artifacts/beyond/entry-open-${language}.png`);
    const openingHud = await page
      .locator('.hud')
      .evaluate((node) => Number(getComputedStyle(node).opacity));
    assert.ok(openingHud > 0.3 && openingHud < 0.5, 'HUD returns with the new orbit');
    await page.getByRole('button', { name: c.pause, exact: true }).click();
    const frozen = await page.evaluate(() => window.__gameDebug.getModel().phaseTicks);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__gameDebug.getModel().phaseTicks), frozen);
    await page.getByRole('button', { name: c.resume, exact: true }).click();
    await pose(2.3);
    await capture(page, `artifacts/beyond/entry-orbit-${language}.png`);
    const orbitHud = await page
      .locator('.hud')
      .evaluate((node) => Number(getComputedStyle(node).opacity));
    assert.ok(orbitHud > openingHud && orbitHud < 1);
    const appearance = () =>
      page.evaluate(() => {
        const scene = window.__gameScene;
        const stroke = scene.graphics.strokeCircle,
          line = scene.graphics.lineStyle,
          segment = scene.graphics.lineBetween;
        let style, ring;
        const trail = [];
        scene.graphics.lineStyle = function (...args) {
          style = args;
          return line.apply(this, args);
        };
        scene.graphics.strokeCircle = function (x, y, radius) {
          if (x === 180 && y === 260 && !ring) ring = { radius, style };
          return stroke.call(this, x, y, radius);
        };
        scene.graphics.lineBetween = function (...args) {
          trail.push({ points: args, style });
          return segment.apply(this, args);
        };
        try {
          scene.update();
        } finally {
          scene.graphics.lineBetween = segment;
          scene.graphics.strokeCircle = stroke;
          scene.graphics.lineStyle = line;
        }
        const electron = scene.sprites.images.find(
          (image) => image.visible && image.texture.key === 'electron',
        );
        return { ring, trail, scale: scene.worldScale, electron: { x: electron.x, y: electron.y } };
      });
    await pose(2.4 - 1 / 60);
    const before = await appearance();
    const entered = await pose(2.4);
    const after = await appearance();
    assert.ok(Math.abs(before.ring.radius - after.ring.radius) * after.scale < 0.1);
    assert.equal(before.ring.style[0], after.ring.style[0]);
    assert.equal(before.ring.style[1], after.ring.style[1]);
    assert.ok(Math.abs(before.ring.style[2] - after.ring.style[2]) < 0.01);
    assert.ok(
      Math.hypot(before.electron.x - after.electron.x, before.electron.y - after.electron.y) <= 1,
    );
    assert.equal(before.trail.length, 8);
    assert.equal(after.trail.length, 8);
    for (let i = 0; i < 8; i++) {
      assert.deepEqual(
        before.trail[i].style,
        after.trail[i].style,
        'Trail width, color and alpha carry into combat',
      );
      for (let j = 0; j < 4; j++)
        assert.ok(
          Math.abs(before.trail[i].points[j] - after.trail[i].points[j]) * after.scale < 0.1,
        );
    }
    assert.equal(entered.phase, 'running');
    assert.equal(entered.seconds, 0);
    await page.waitForFunction(
      () => Number(getComputedStyle(document.querySelector('.hud')).opacity) === 1,
    );
    await page.evaluate(() => {
      const debug = window.__gameDebug,
        g = debug.getModel();
      g.setHidden(false);
      debug.advance(4000);
      g.setHidden(true);
    });
    assert.equal(await page.locator('.beyond-symbol').innerText(), '∞');
    assert.deepEqual(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), recordKey),
      original,
    );
    const state = await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      return {
        ranks: g.ranks,
        rarities: g.rarities,
        targets: g.targets.length,
        seconds: g.endlessSeconds,
      };
    });
    assert.deepEqual(state.ranks, initial.ranks);
    assert.deepEqual(state.rarities, initial.rarities);
    assert.ok(state.targets > 0 && state.targets <= 240);
    assert.equal(await page.getByRole('button', { name: c.beyond, exact: true }).count(), 0);
    await capture(page, `artifacts/beyond/play-${language}.png`);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
    if (language === 'en') {
      await page.getByRole('button', { name: c.pause, exact: true }).click();
      await page.getByRole('button', { name: c.quit, exact: true }).click();
      await page.getByRole('button', { name: c.quitConfirm, exact: true }).click();
    } else {
      await page.evaluate(() => {
        const debug = window.__gameDebug,
          g = debug.getModel();
        g.setHidden(false);
        g.mass = 1000;
        g.radius = g.core + g.rules.electronRadius;
        debug.advance(10000);
      });
      await page.getByRole('heading', { name: c.beyond, exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.result button.primary').disabled);
      assert.equal(await page.getByRole('button', { name: c.beyond, exact: true }).count(), 0);
      await capture(page, `artifacts/beyond/end-${language}.png`);
      await page.getByRole('button', { name: c.finish, exact: true }).click();
    }
    await page.getByRole('button', { name: 'START', exact: true }).waitFor();
    await page.waitForFunction((key) => !!localStorage.getItem(key), beyondRecordKey);
    const record = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      beyondRecordKey,
    );
    assert.ok(record.seconds >= 4);
    assert.deepEqual(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), recordKey),
      original,
    );
    const seed = await page.evaluate(() => window.__gameDebug.getModel().seed);
    await page.reload();
    await page.waitForFunction(() => !!window.__gameDebug);
    const fresh = await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      return { phase: g.phase, seed: g.seed, endless: g.endless };
    });
    assert.equal(fresh.phase, 'ready');
    assert.equal(fresh.endless, false);
    assert.notEqual(fresh.seed, seed);
    if (language === 'en') {
      await showSuccess(page);
      await page.getByRole('heading', { name: c.success, exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.result button.primary').disabled);
      await page.getByRole('button', { name: c.finish, exact: true }).tap();
      await page.getByRole('button', { name: 'START', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__gameDebug.getModel().endless), false);
    }
    rows.push({ width, height, language, motion, record, contraction });
    console.log(JSON.stringify(rows.at(-1)));
    await page.close();
  }
  assert.deepEqual(errors, []);
  mkdirSync('artifacts/beyond', { recursive: true });
  writeFileSync('artifacts/beyond/browser.json', JSON.stringify({ rows, errors }, null, 2));
} finally {
  await browser.close();
}
