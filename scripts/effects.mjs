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
    const result = await page.evaluate(async () => {
      const scene = window.__gameScene;
      const texture = scene.textures.get('effects');
      if (texture.key !== 'effects') throw new Error('Pixel effects did not load');
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(texture.source[0].image, 0, 0);
      const pixels = ctx.getImageData(0, 0, 128, 96).data;
      const alpha = (x, y) => pixels[(y * 128 + x) * 4 + 3];
      const frames = [];
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 4; col++) {
          let painted = 0;
          for (let y = 0; y < 32; y++)
            for (let x = 0; x < 32; x++) if (alpha(col * 32 + x, row * 32 + y) > 180) painted++;
          if (!painted) throw new Error(`Empty animation frame ${row}:${col}`);
          if (alpha(col * 32, row * 32) !== 0) throw new Error('Nontransparent frame margin');
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
      const circles = [];
      const originalCircle = scene.effectGraphics.strokeCircle.bind(scene.effectGraphics);
      scene.effectGraphics.strokeCircle = (...args) => {
        circles.push(args);
        return originalCircle(...args);
      };
      scene.update();
      scene.effectGraphics.strokeCircle = originalCircle;
      const aura = circles.slice(-2);
      const electron = scene.sprites.images.find(
        (s) => s.visible && s.texture.key === 'electronSurge',
      );
      if (aura.length !== 2 || !electron) throw new Error('Surge lacks its procedural aura');
      if (JSON.stringify(aura[0]) !== JSON.stringify(aura[1]))
        throw new Error('Glow and contour must share one radius');
      if (aura[0][0] !== g.position.x || aura[0][1] !== g.position.y)
        throw new Error('Aura drifts from the electron');
      if (electron.displayWidth !== 16)
        throw new Error('Electron must retain its native 16-pixel size');
      const auraPixels = aura[0][2] * scene.worldScale * 2,
        electronPixels = electron.displayWidth;
      if (Math.abs(auraPixels - 22) > 0.01) throw new Error('Rank-one aura must stay compact');
      const beamTexture = scene.textures.get('beams');
      if (beamTexture.key !== 'beams') throw new Error('Pixel beams did not load');
      canvas.width = 256;
      canvas.height = 1280;
      ctx.drawImage(beamTexture.source[0].image, 0, 0);
      const beamPixels = ctx.getImageData(0, 0, 256, 1280).data;
      const beamAlpha = (x, y) => beamPixels[(y * 256 + x) * 4 + 3];
      for (let row = 0; row < 80; row++)
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
      const powerFrames = [];
      const poolBeforePowers = scene.sprites.images.length;
      for (const damage of [5, 10, 10.01, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150]) {
        combat.effects.forEach((fx) => (fx.damage = damage));
        scene.update();
        const beam = scene.sprites.images.find((s) => s.visible && s.texture.key === 'beams');
        const tier = Math.max(1, Math.min(10, Math.ceil(damage / 10))) - 1;
        if (!beam || Math.floor(Number(beam.frame.name) / 32) !== tier)
          throw Error(`Focus does not render its actual ${damage} damage`);
        powerFrames.push(Number(beam.frame.name));
        for (let rank = 1; rank <= 5; rank++) {
          combat.effects.forEach((fx) => (fx.rank = rank));
          scene.update();
          if (Number(beam.frame.name) !== powerFrames.at(-1))
            throw Error('Unchanged damage must not thicken with skill level');
        }
      }
      if (scene.sprites.images.length !== poolBeforePowers)
        throw Error('Higher damage allocates extra beam sprites');
      const strikeChecks = [];
      for (const [rank, rarity, power] of [
        [1, 'common', 0],
        [5, 'common', 0],
        [5, 'legendary', 3],
      ]) {
        debug.restart(17, false);
        const striker = debug.getModel();
        striker.angle = 0;
        striker.ranks.strike = rank;
        striker.rarities.strike = rarity;
        striker.boosts.power = power;
        striker.rarities.power = rarity;
        const { target } = await import('/tests/helpers.ts');
        striker.targets = [
          target(900, 210, 210, 100000),
          target(901, 250, 230, 100000),
          target(902, 290, 240, 100000),
        ];
        striker.counts.quark.generated = 3;
        if (!striker.combat.fireSkill('strike')) throw Error('Strike fixture must actually cast');
        striker.setHidden(true);
        debug.advance(0);
        scene.update();
        const strikes = scene.sprites.images.filter(
          (s) =>
            s.visible &&
            s.texture.key === 'beams' &&
            Number(s.frame.name) % 32 >= 12 &&
            Number(s.frame.name) % 32 < 16,
        );
        if (strikes.length !== Math.min(rank, 3)) throw Error('Strike target count changed');
        if (strikes.some((s) => s.tintTopLeft !== 0xffffff))
          throw Error('Strike tint hides its white core');
        const effects = striker.effects.filter((fx) => fx.kind === 'strike');
        for (let i = 0; i < effects.length; i++) {
          const beam = strikes[i],
            fx = effects[i],
            from = scene.screen(fx.from),
            to = scene.screen(fx.to);
          for (const [point, side] of [
            [from, -1],
            [to, 1],
          ]) {
            near(beam.x + (side * Math.cos(beam.rotation) * beam.displayWidth) / 2, point.x);
            near(beam.y + (side * Math.sin(beam.rotation) * beam.displayWidth) / 2, point.y);
          }
        }
        const before = JSON.stringify(striker, (key, value) =>
          key === 'combat' ? undefined : value,
        );
        const frozen = JSON.stringify(visible()),
          pool = scene.sprites.images.length;
        for (let i = 0; i < 60; i++) scene.update();
        if (
          JSON.stringify(striker, (key, value) => (key === 'combat' ? undefined : value)) !== before
        )
          throw Error('Strike rendering changes combat');
        if (JSON.stringify(visible()) !== frozen || scene.sprites.images.length !== pool)
          throw Error('Paused strikes move or grow their pool');
        strikeChecks.push({
          rank,
          rarity,
          power,
          damage: effects[0].damage,
          beams: strikes.length,
        });
      }
      return {
        frames: frames.length,
        beamFrames: 320,
        powerFrames,
        strikeChecks,
        trackedBeam: true,
        hits: casts,
        pool,
        frozen: true,
        centered: true,
        auraPixels,
        electronPixels,
      };
    });
    assert.equal(result.frames, 12);
    assert.equal(result.beamFrames, 320);
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
