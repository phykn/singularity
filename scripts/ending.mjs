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
    [375, 812, 'ko'],
    [568, 320, 'en'],
    [320, 568, 'zh'],
    [812, 375, 'ja'],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (error) => errors.push(error.message));
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
      d.restart(1701);
      const g = d.getModel();
      for (let i = 0; i < 6000 && g.phase === 'running'; i++) d.advance(125);
      g.setHidden(true);
      d.advance(0);
      return {
        phase: g.phase,
        success: g.successfulEnding,
        xp: g.xp,
        mass: g.mass,
        counts: g.counts,
        selections: g.selections,
      };
    });
    assert.equal(collision.phase, 'collapse');
    assert.equal(collision.success, true);
    const poses = [];
    let hud = 1;
    for (const [name, phase, time] of [
      ['accelerate', 'collapse', 0.3],
      ['compress', 'collapse', 0.9],
      ['silence', 'collapse', 1.5],
      ['flash', 'ending', 0.02],
      ['formation', 'ending', 0.24],
      ['settle', 'ending', 0.8],
      ['quiet', 'ending', 2.1],
      ['hold', 'ending', 2.6],
      ['result', 'result', 0],
    ]) {
      const state = await page.evaluate(
        ({ phase, time }) => {
          const d = window.__gameDebug,
            g = d.getModel(),
            scene = window.__gameScene;
          g.setHidden(false);
          if (phase === 'result') d.advance(5000);
          else {
            if (g.phase !== phase)
              d.advance((g.rules.collisionSeconds - g.phaseTicks / g.rules.tickRate) * 1000);
            d.advance(Math.max(0, time * 1000 - (g.phaseTicks / g.rules.tickRate) * 1000));
          }
          g.setHidden(true);
          const fill = scene.graphics.fillCircle,
            line = scene.graphics.lineBetween,
            stroke = scene.graphics.strokePoints,
            draw = scene.drawSingularity,
            sprite = scene.sprites.draw;
          const points = [],
            radii = [];
          let hole = 0;
          scene.graphics.fillCircle = function (x, y, r, ...args) {
            radii.push(r);
            return fill.call(this, x, y, r, ...args);
          };
          scene.graphics.lineBetween = function (x, y, x2, y2, ...args) {
            if (g.phase !== 'collapse')
              radii.push(Math.hypot(x - 180, y - 260), Math.hypot(x2 - 180, y2 - 260));
            return line.call(this, x, y, x2, y2, ...args);
          };
          scene.graphics.strokePoints = function (points, ...args) {
            if (g.phase !== 'collapse')
              radii.push(...points.map((p) => Math.hypot(p.x - 180, p.y - 260)));
            return stroke.call(this, points, ...args);
          };
          scene.drawSingularity = function (r, ...args) {
            hole = r;
            return draw.call(this, r, ...args);
          };
          scene.sprites.draw = function (p, ...args) {
            points.push(p);
            return sprite.call(this, p, ...args);
          };
          try {
            scene.update();
          } finally {
            scene.graphics.fillCircle = fill;
            scene.graphics.lineBetween = line;
            scene.graphics.strokePoints = stroke;
            scene.drawSingularity = draw;
            scene.sprites.draw = sprite;
          }
          return {
            phase: g.phase,
            xp: g.xp,
            mass: g.mass,
            counts: g.counts,
            selections: g.selections,
            hole,
            sprites: points.length,
            maxRadius: Math.max(0, ...radii),
            scale: scene.worldScale,
            inside: hole
              ? points.filter(
                  (p) =>
                    Math.hypot(p.x - innerWidth / 2, p.y - scene.centerY) <=
                    hole * scene.worldScale,
                ).length
              : 0,
          };
        },
        { phase, time },
      );
      assert.equal(state.phase, phase);
      assert.equal(state.xp, collision.xp);
      assert.equal(state.mass, collision.mass);
      assert.deepEqual(state.counts, collision.counts);
      assert.deepEqual(state.selections, collision.selections);
      if (phase !== 'collapse') {
        assert.ok(state.hole > 0 && state.hole <= 24);
        assert.ok(state.maxRadius <= 40 + 2 / state.scale, 'The tilted disk stays compact');
        assert.equal(state.inside, 0, 'Absorbed particles must not cover the singularity');
      }
      if (name === 'silence') assert.equal(state.sprites, 0, 'Only the central point remains');
      await page.waitForTimeout(phase === 'result' ? 650 : 60);
      const opacity = await page
        .locator('.hud')
        .evaluate((node) => Number(getComputedStyle(node).opacity));
      assert.ok(opacity >= 0.219 && opacity <= hud + 1e-8);
      assert.equal(
        await page
          .locator('.play-footer')
          .evaluate((node) => Number(getComputedStyle(node).opacity)),
        opacity,
      );
      hud = opacity;
      await capture(page, `artifacts/ending/${name}-${language}.png`);
      poses.push({ name, hole: state.hole, maxRadius: state.maxRadius, hud: opacity });
    }
    assert.equal(await page.locator('#result-title').innerText(), copy[language].success);
    assert.equal(await page.locator('.singularity-symbol').count(), 1);
    assert.equal(await page.locator('.collapse-symbol').count(), 0);
    assert.equal(await page.locator('.result-numbers > div').count(), 3);
    const ranks = await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      return g.ownedSkills.map((id) => g.rank(id));
    });
    assert.deepEqual(
      await page
        .locator('.result-build [role="img"]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
      ranks.map((rank) => `${copy[language].rank} ${rank}/5`),
      'The final build exposes every skill rank without extra visible copy',
    );
    const layout = await page.evaluate(() => {
      const r = document.querySelector('#result-title').getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(layout.overflow, false);
    assert.ok(layout.left >= 0 && layout.right <= layout.width);
    checks.push({
      width,
      height,
      language,
      collision: { xp: collision.xp, mass: collision.mass },
      poses,
      layout,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/ending.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(
    JSON.stringify({
      cases: checks.length,
      poses: checks.reduce((n, c) => n + c.poses.length, 0),
      errors,
    }),
  );
} finally {
  await browser.close();
}
