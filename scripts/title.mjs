import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { base, launchBrowser, observeScene, capture } from './browser-support.mjs';
import { copy, languages } from '../src/ui/i18n.ts';

const browser = await launchBrowser();
const checks = [],
  errors = [];
try {
  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [568, 320],
    [1024, 768],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: width < 600,
      hasTouch: true,
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.titleAudio = { contexts: [], started: 0, previews: [] };
      const Native = AudioContext;
      window.AudioContext = class extends Native {
        constructor(...args) {
          super(...args);
          window.titleAudio.contexts.push(this);
        }
        createBufferSource() {
          const source = super.createBufferSource(),
            start = source.start.bind(source);
          source.start = (...args) => {
            window.titleAudio.started++;
            const preview = {
              at: this.currentTime,
              expected: source.buffer.duration / source.playbackRate.value,
              duration: null,
            };
            window.titleAudio.previews.push(preview);
            source.addEventListener('ended', () => {
              preview.duration = this.currentTime - preview.at;
            });
            return start(...args);
          };
          return source;
        }
      };
    });
    await observeScene(page);
    await page.goto(base);
    await page.waitForFunction(
      () => window.__gameScene && window.__gameDebug && !document.querySelector('.start')?.disabled,
    );
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const caption = document.querySelector('.arena-caption');
      const title = document.querySelector('.arena-caption h1').getBoundingClientRect();
      const start = document.querySelector('.start').getBoundingClientRect();
      const meta = document.querySelector('.title-meta').getBoundingClientRect();
      const sound = document.querySelector('.title-sound').getBoundingClientRect();
      const arena = document.querySelector('.arena').getBoundingClientRect();
      const github = document.querySelector('.github-link').getBoundingClientRect();
      const scene = window.__gameScene;
      const orbitTop =
        arena.top + scene.centerY - window.__gameDebug.getModel().radius * scene.worldScale;
      caption.style.pointerEvents = 'auto';
      const titleVisible = caption.contains(
        document.elementFromPoint((title.left + title.right) / 2, (title.top + title.bottom) / 2),
      );
      caption.style.pointerEvents = '';
      return {
        titleVisible,
        orbitTop,
        githubBottom: github.bottom,
        title: { left: title.left, right: title.right, top: title.top, bottom: title.bottom },
        start: { top: start.top },
        height: document.documentElement.scrollHeight,
        meta: { left: meta.left, right: meta.right, top: meta.top },
        sound: {
          left: sound.left,
          right: sound.right,
          top: sound.top,
          bottom: sound.bottom,
          height: sound.height,
        },
        arena: { top: arena.top, height: arena.height },
        clipped: [...document.querySelectorAll('.arena-caption h1, .title-sound-label')].some(
          (node) => node.scrollWidth > node.clientWidth + 1,
        ),
      };
    });
    assert.ok(layout.title.left >= 0 && layout.title.right <= width);
    assert.equal(layout.titleVisible, true, 'The canvas must not cover the title');
    if (height > width) assert.ok(layout.title.bottom <= layout.start.top);
    assert.equal(layout.height, height);
    assert.ok(layout.title.bottom <= layout.meta.top || layout.title.right <= layout.meta.left);
    assert.ok(layout.title.top < layout.arena.top + layout.arena.height * 0.25);
    if (!(height <= 600 && width > height)) {
      assert.ok(layout.title.top > layout.githubBottom, 'The title must clear the GitHub link');
      assert.ok(layout.title.bottom < layout.orbitTop, 'The title must clear the orbit');
      assert.ok(
        Math.abs(
          (layout.title.top + layout.title.bottom - layout.githubBottom - layout.orbitTop) / 2,
        ) < 1,
        'The title must be centered between GitHub and the actual rendered orbit',
      );
    }
    assert.ok(layout.sound.left >= 0 && layout.sound.right <= width);
    assert.ok(layout.sound.top >= 48 && layout.sound.height >= 44);
    assert.ok(layout.sound.bottom < layout.start.top);
    assert.equal(layout.clipped, false);
    const soundButton = page.locator('.title-sound');
    assert.equal(await soundButton.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => window.titleAudio.contexts.length), 0);
    await soundButton.tap();
    await page.waitForFunction(() => window.titleAudio.started === 1);
    assert.equal(await soundButton.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.titleAudio.contexts[0].state), 'running');
    await page.waitForFunction(() => window.titleAudio.previews[0].duration !== null);
    assert.ok(
      await page.evaluate(
        () =>
          window.titleAudio.previews[0].duration >= window.titleAudio.previews[0].expected - 0.025,
      ),
      'The title preview must not be cut off by the next ready frame',
    );
    await page.getByRole('button', { name: '설정', exact: true }).click();
    assert.equal(await page.locator('.setting-row').getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await soundButton.tap();
    await page.waitForFunction(() => window.titleAudio.contexts[0].state === 'suspended');
    assert.equal(await soundButton.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => window.__gameDebug.getModel().elapsedTicks), 0);
    await soundButton.tap();
    await page.waitForFunction(() => window.titleAudio.started === 2);
    await page
      .getByRole('button', {
        name: languages.find((entry) => entry.id === 'en').label,
        exact: true,
      })
      .click();
    await page.reload();
    await page.waitForFunction(
      () => window.__gameScene && !document.querySelector('.start')?.disabled,
    );
    assert.equal(
      await soundButton.getAttribute('aria-pressed'),
      'false',
      'Reload starts muted after enabling sound',
    );
    assert.equal(await page.evaluate(() => window.titleAudio.contexts.length), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      'en',
      'Language remains saved',
    );
    await page.getByRole('button', { name: '한국어', exact: true }).click();
    for (const language of languages) {
      await page.getByRole('button', { name: language.label, exact: true }).click();
      assert.equal(
        await page.locator('.sound-recommendation').innerText(),
        copy[language.id].soundRecommended,
      );
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(
        await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '.title-sound, .title-sound-label, .sound-recommendation, .arena-caption h1',
            ),
          ]
            .filter((node) => {
              const r = node.getBoundingClientRect();
              return (
                node.scrollWidth > node.clientWidth + 1 ||
                r.left < 0 ||
                r.right > innerWidth ||
                r.top < 0 ||
                r.bottom > innerHeight
              );
            })
            .map((node) => node.textContent),
        ),
        [],
        'Localized title controls must remain readable',
      );
      if (language.id === 'en' && width === 375)
        await capture(page, 'artifacts/title-polish/title-en.png');
    }
    await page.getByRole('button', { name: '한국어', exact: true }).click();
    const idle = await page.evaluate(() => ({
      angle: window.__gameDebug.getModel().angle,
      tick: window.__gameDebug.getModel().elapsedTicks,
      targets: window.__gameDebug.getModel().targets.length,
    }));
    await page.waitForTimeout(150);
    const later = await page.evaluate(() => ({
      angle: window.__gameDebug.getModel().angle,
      tick: window.__gameDebug.getModel().elapsedTicks,
      targets: window.__gameDebug.getModel().targets.length,
    }));
    assert.ok(later.angle > idle.angle);
    assert.equal(later.tick, 0);
    assert.equal(later.targets, 0);
    await capture(page, `artifacts/title-polish/title-${width}.png`);
    for (const [i, wait] of [0, 300, 900].entries()) {
      if (i > 0) await page.evaluate(() => window.__gameDebug.prepare(10004));
      await page.getByRole('button', { name: 'START', exact: true }).waitFor();
      await page.waitForTimeout(wait);
      await page.emulateMedia({ reducedMotion: i === 2 ? 'reduce' : 'no-preference' });
      const seam = await page.evaluate(async () => {
        const scene = window.__gameScene,
          game = window.__gameDebug.getModel();
        const pose = () => {
          scene.update();
          const image = scene.sprites.images.find(
            (image) => image.visible && image.texture.key === 'electron',
          );
          const r = scene.game.canvas.getBoundingClientRect();
          return {
            x: r.left + image.x,
            y: r.top + image.y,
            alpha: image.alpha,
            size: image.displayWidth,
            angle: game.angle,
            radius: game.radius * scene.worldScale,
            rect: [r.left, r.top, r.width, r.height],
          };
        };
        const before = pose(),
          start = document.querySelector('.start');
        start.click();
        start.click();
        game.setHidden(true);
        const immediate = pose();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const after = pose();
        return {
          before,
          immediate,
          after,
          phase: game.phase,
          tick: game.elapsedTicks,
          targets: game.targets.length,
          starts: game.events.filter((event) => event.kind === 'start').length,
        };
      });
      assert.equal(seam.phase, 'running');
      assert.equal(seam.tick, 0);
      assert.ok(seam.targets > 0);
      assert.equal(seam.starts, 1);
      for (const pose of [seam.immediate, seam.after]) {
        assert.equal(pose.angle, seam.before.angle);
        assert.equal(pose.radius, seam.before.radius);
        assert.deepEqual(pose.rect, seam.before.rect);
        assert.ok(Math.hypot(pose.x - seam.before.x, pose.y - seam.before.y) <= 1);
        assert.equal(pose.alpha, 1);
        assert.equal(pose.size, 16);
      }
      checks.push({ viewport: [width, height], wait, reducedMotion: i === 2, layout, seam });
    }
    await page.locator('.hud').waitFor();
    await capture(page, `artifacts/title-polish/started-${width}.png`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/title-polish.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ viewports: 4, starts: checks.length, errors }));
} finally {
  await browser.close();
}
