import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { base, capture, launchBrowser, observeScene } from './browser-support.mjs';

const browser = await launchBrowser();
const checks = [],
  errors = [];
try {
  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [568, 320],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await observeScene(page);
    await page.goto(base);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    const result = await page.evaluate(() => {
      const scene = window.__gameScene;
      const texture = scene.textures.get('effects');
      if (texture.key !== 'effects') throw new Error('Generated effects did not load');
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(texture.source[0].image, 0, 0);
      const pixels = ctx.getImageData(0, 0, 128, 192).data;
      const alpha = (x, y) => pixels[(y * 128 + x) * 4 + 3];
      const frames = [];
      for (let row = 0; row < 6; row++)
        for (let col = 0; col < 4; col++) {
          let painted = 0;
          for (let y = 0; y < 32; y++)
            for (let x = 0; x < 32; x++) if (alpha(col * 32 + x, row * 32 + y) > 180) painted++;
          if (!painted) throw new Error(`Empty animation frame ${row}:${col}`);
          // Generated alpha can retain a one-step rounding residue in empty margins.
          if (alpha(col * 32, row * 32) > 1) throw new Error('Nontransparent frame margin');
          if (row === 3 || row === 4)
            for (let y = 14; y < 18; y++)
              for (let x = 14; x < 18; x++)
                if (alpha(col * 32 + x, row * 32 + y) > 16)
                  throw new Error('Aura hides its particle center');
          frames.push(painted);
        }
      const debug = window.__gameDebug;
      debug.restart(17, false);
      const g = debug.getModel();
      g.ranks.surge = 1;
      for (let i = 0; i < g.forms.surge.kills; i++) {
        const target = {
          id: i,
          ...g.position,
          hp: 1,
          maxHp: 1,
          kind: 'small',
          particle: 'quark',
          born: 0,
          xp: 1,
          mass: 1,
          size: 5,
          angle: g.angle,
          radius: g.radius,
          speed: 0,
          turn: 0,
        };
        g.targets.push(target);
        g.counts.quark.generated++;
        g.damageTarget(target, 1);
      }
      debug.advance(150);
      g.setHidden(true);
      scene.update();
      const visible = () =>
        scene.sprites
          .filter((s) => s.visible)
          .map((s) => [s.texture.key, s.frame.name, s.x, s.y, s.alpha, s.tintTopLeft]);
      const frozen = JSON.stringify(visible()),
        pool = scene.sprites.length;
      for (let i = 0; i < 120; i++) scene.update();
      if (JSON.stringify(visible()) !== frozen) throw new Error('Paused effects keep animating');
      if (scene.sprites.length !== pool) throw new Error('Effect pool grows every render');
      const aura = scene.sprites.find(
        (s) =>
          s.visible &&
          s.texture.key === 'effects' &&
          Number(s.frame.name) >= 16 &&
          Number(s.frame.name) < 20,
      );
      const electron = scene.sprites.find((s) => s.visible && s.texture.key === 'electronSurge');
      if (!aura || !electron) throw new Error('Surge lacks its aura or energized electron');
      if (aura.x !== electron.x || aura.y !== electron.y)
        throw new Error('Aura drifts from the electron');
      if (aura.displayWidth !== 32 || electron.displayWidth !== 13)
        throw new Error('Native sprites were enlarged');
      return {
        frames: frames.length,
        pool,
        frozen: true,
        centered: true,
        auraPixels: aura.displayWidth,
        electronPixels: electron.displayWidth,
      };
    });
    assert.equal(result.frames, 24);
    await capture(page, `artifacts/screens/effects-surge-${width}x${height}.png`);
    checks.push({ viewport: [width, height], ...result });
    console.log('PASS generated effects', JSON.stringify(checks.at(-1)));
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/effects.json', JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
