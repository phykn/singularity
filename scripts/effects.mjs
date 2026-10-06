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
      if (texture.key !== 'effects') throw new Error('Pixel effects did not load');
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
          if (alpha(col * 32, row * 32) !== 0) throw new Error('Nontransparent frame margin');
          if (row === 2 || row === 3)
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
        scene.sprites.images
          .filter((s) => s.visible)
          .map((s) => [s.texture.key, s.frame.name, s.x, s.y, s.alpha, s.tintTopLeft]);
      const frozen = JSON.stringify(visible()),
        pool = scene.sprites.images.length;
      for (let i = 0; i < 120; i++) scene.update();
      if (JSON.stringify(visible()) !== frozen) throw new Error('Paused effects keep animating');
      if (scene.sprites.images.length !== pool) throw new Error('Effect pool grows every render');
      const aura = scene.sprites.images.find(
        (s) =>
          s.visible &&
          s.texture.key === 'effects' &&
          Number(s.frame.name) >= 12 &&
          Number(s.frame.name) < 16,
      );
      const electron = scene.sprites.images.find(
        (s) => s.visible && s.texture.key === 'electronSurge',
      );
      if (!aura || !electron) throw new Error('Surge lacks its aura or energized electron');
      if (aura.x !== electron.x || aura.y !== electron.y)
        throw new Error('Aura drifts from the electron');
      if (aura.displayWidth !== 32 || electron.displayWidth !== 16)
        throw new Error('Particles must use native 16-pixel texture cells');
      const auraPixels = aura.displayWidth,
        electronPixels = electron.displayWidth;
      const beamTexture = scene.textures.get('beams');
      if (beamTexture.key !== 'beams') throw new Error('Pixel beams did not load');
      canvas.width = 256;
      canvas.height = 128;
      ctx.drawImage(beamTexture.source[0].image, 0, 0);
      const beamPixels = ctx.getImageData(0, 0, 256, 128).data;
      const beamAlpha = (x, y) => beamPixels[(y * 256 + x) * 4 + 3];
      for (let row = 0; row < 8; row++)
        for (let col = 0; col < 4; col++) {
          let painted = 0;
          for (let y = 0; y < 16; y++)
            for (let x = 0; x < 64; x++) if (beamAlpha(col * 64 + x, row * 16 + y) > 180) painted++;
          if (!painted) throw new Error(`Empty beam frame ${row}:${col}`);
          if (beamAlpha(col * 64, row * 16) > 1) throw new Error('Nontransparent beam margin');
        }

      debug.restart(17, false);
      const combat = debug.getModel();
      combat.ranks.focus = 1;
      const tracked = {
        id: 701,
        x: combat.position.x + 40,
        y: combat.position.y + 20,
        hp: 1000,
        maxHp: 1000,
        kind: 'small',
        particle: 'muon',
        born: 0,
        xp: 1,
        mass: 1,
        size: 5,
        angle: 0,
        radius: 100,
        speed: 0,
        turn: 0,
      };
      combat.targets = [tracked];
      if (!combat.combat.fireSkill('focus')) throw new Error('Focus did not cast');
      combat.combat.update();
      combat.setHidden(true);
      const casts = combat.events.filter((event) => event.kind === 'hit').length;
      if (!casts) throw new Error('Focus fixture must actually hit');
      const near = (actual, expected) => {
        if (Math.abs(actual - expected) > 1.01)
          throw new Error(`Beam geometry drift: ${actual} vs ${expected}`);
      };
      for (const [angle, dx, dy] of [
        [0, 50, 0],
        [1, 0, 50],
        [2, -40, -30],
        [3, 0, 0],
      ]) {
        combat.angle = angle;
        Object.assign(tracked, { x: combat.position.x + dx, y: combat.position.y + dy });
        scene.update();
        const beam = scene.sprites.images.find((s) => s.visible && s.texture.key === 'beams');
        if (!dx && !dy) {
          if (beam) throw new Error('Coincident endpoints must skip the beam');
          continue;
        }
        if (!beam || Number(beam.frame.name) < 16 || Number(beam.frame.name) >= 20)
          throw new Error('Real focus cast lacks focused lightning');
        const from = scene.screen(combat.position),
          to = scene.screen(tracked);
        for (const [point, side] of [
          [from, -1],
          [to, 1],
        ]) {
          near(beam.x + (side * Math.cos(beam.rotation) * beam.displayWidth) / 2, point.x);
          near(beam.y + (side * Math.sin(beam.rotation) * beam.displayWidth) / 2, point.y);
        }
        const frozenBeam = JSON.stringify(visible()),
          beamPool = scene.sprites.images.length;
        for (let i = 0; i < 30; i++) scene.update();
        if (JSON.stringify(visible()) !== frozenBeam)
          throw new Error('Paused beam keeps animating');
        if (scene.sprites.images.length !== beamPool)
          throw new Error('Beam pool grows every render');
      }
      // Shift pooled beam slots into particle slots; rotation and scale must reset.
      combat.targets.push(...Array.from({ length: 4 }, (_, i) => ({ ...tracked, id: 800 + i })));
      scene.update();
      const particles = scene.sprites.images.filter((s) => s.visible && s.texture.key === 'muon');
      if (
        particles.some((s) => s.rotation !== 0 || s.displayWidth !== 16 || s.displayHeight !== 16)
      )
        throw new Error('Reused beam geometry leaked into native particles');
      Object.assign(tracked, { x: combat.position.x + 50, y: combat.position.y + 20 });
      scene.update();
      return {
        frames: frames.length,
        beamFrames: 32,
        trackedBeam: true,
        hits: casts,
        pool,
        frozen: true,
        centered: true,
        auraPixels,
        electronPixels,
      };
    });
    assert.equal(result.frames, 24);
    assert.equal(result.beamFrames, 32);
    await capture(page, `artifacts/screens/effects-tracked-${width}x${height}.png`);
    checks.push({ viewport: [width, height], ...result });
    console.log('PASS pixel effects', JSON.stringify(checks.at(-1)));
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/effects.json', JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
