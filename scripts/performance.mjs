import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, capture, launchBrowser } from './browser-support.mjs';

// Frozen crowds isolate drawing; live crowds also exercise movement and attacks.
// CPU throttling approximates a slower processor, not a particular phone.
const output = process.argv[2] ?? 'artifacts/performance/latest';
const slowdown = Number(process.env.CPU_SLOWDOWN ?? 4);
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
});
const errors = [];
page.on('pageerror', (error) => {
  errors.push(error.message);
  console.error(error.message);
});
try {
  await page.route('**/src/render/scene.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body:
        body +
        '\nconst create = ElectronScene.prototype.create; ElectronScene.prototype.create = function(...args) { window.__perfScene = this; return create.apply(this, args); };',
    });
  });
  await page.goto(base + '/?seed=1705');
  await page.waitForFunction(() => !!window.__gameDebug);
  await page.waitForSelector('canvas');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !!window.__perfScene);
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
  const rows = [];
  for (const count of process.argv.includes('--live') ? [] : [200, 800, 1600]) {
    await page.evaluate(async (count) => {
      const { orbit } = await import('/src/game/geometry.ts');
      const debug = window.__gameDebug;
      debug.restart(1705, false);
      const game = debug.getModel();
      game.setHidden(true);
      game.tick = game.elapsedTicks = 27000;
      game.mass = 80;
      game.radius = 100;
      game.boosts = { power: 4, rate: 4, range: 4 };
      Object.assign(game.ranks, { area: 5, multi: 5, repeat: 5, chain: 5 });
      const particles = ['quark', 'muon', 'proton', 'neutron'];
      game.targets = Array.from({ length: count }, (_, id) => {
        const radius = 40 + ((id * 79) % 130);
        const angle = id * Math.PI * (3 - Math.sqrt(5));
        return {
          id,
          ...orbit(angle, radius),
          radius,
          angle,
          particle: particles[id % 4],
          kind: id % 4 < 2 ? 'small' : 'dense',
          hp: 10000,
          maxHp: 10000,
          born: game.time - 1,
          xp: 1,
          mass: 1,
          size: id % 4 < 2 ? 5 : 8,
          speed: 0,
          turn: 0,
        };
      });
      game.combat.fireBasic();
      for (const target of game.targets) delete target.hitAt;
      game.choice = null;
      debug.advance(0);
    }, count);
    await page.waitForTimeout(250);
    if (process.argv.includes('--profile')) {
      await client.send('Profiler.enable');
      await client.send('Profiler.start');
    }
    const row = await page.evaluate(async () => {
      const scene = window.__perfScene;
      const game = window.__gameDebug.getModel();
      const quantile = (values, fraction) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor((sorted.length - 1) * fraction)];
      };
      for (let i = 0; i < 20; i++) scene.update();
      let textUpdates = 0;
      const textGroup = scene.damageText;
      const texts = Array.isArray(textGroup) ? textGroup : Array.from(textGroup.children);
      const originals = texts.map((text) => text.updateText);
      texts.forEach((text) => {
        const update = text.updateText;
        text.updateText = function (...args) {
          textUpdates++;
          return update.apply(this, args);
        };
      });
      const draws = [];
      for (let i = 0; i < 120; i++) {
        const start = performance.now();
        scene.update();
        draws.push(performance.now() - start);
      }
      texts.forEach((text, i) => (text.updateText = originals[i]));
      const gl = scene.sys.game.renderer.gl;
      const drawArrays = gl.drawArrays,
        drawElements = gl.drawElements;
      let drawCalls = 0;
      const renderTimes = [];
      let renderStart;
      const preRender = () => (renderStart = performance.now());
      const postRender = () => renderTimes.push(performance.now() - renderStart);
      scene.sys.game.events.on('prerender', preRender);
      scene.sys.game.events.on('postrender', postRender);
      gl.drawArrays = function (...args) {
        drawCalls++;
        return drawArrays.apply(this, args);
      };
      gl.drawElements = function (...args) {
        drawCalls++;
        return drawElements.apply(this, args);
      };
      const frames = await new Promise((resolve) => {
        const intervals = [];
        let previous;
        const sample = (now) => {
          if (previous !== undefined) intervals.push(now - previous);
          previous = now;
          if (intervals.length < 120) requestAnimationFrame(sample);
          else resolve(intervals);
        };
        requestAnimationFrame(sample);
      });
      gl.drawArrays = drawArrays;
      gl.drawElements = drawElements;
      scene.sys.game.events.off('prerender', preRender);
      scene.sys.game.events.off('postrender', postRender);
      return {
        targets: game.targets.length,
        effects: game.effects.length,
        damageNumbers: game.damageNumbers.length,
        sceneMedianMs: quantile(draws, 0.5),
        sceneP95Ms: quantile(draws, 0.95),
        textUpdatesPerFrame: textUpdates / draws.length,
        drawCallsPerFrame: drawCalls / frames.length,
        renderMedianMs: quantile(renderTimes, 0.5),
        renderP95Ms: quantile(renderTimes, 0.95),
        frameMedianMs: quantile(frames, 0.5),
        frameP95Ms: quantile(frames, 0.95),
      };
    });
    if (process.argv.includes('--profile')) {
      const { profile } = await client.send('Profiler.stop');
      writeFileSync(`${output}/cpu-${count}.json`, JSON.stringify(profile));
    }
    assert.equal(row.targets, count);
    const screenshot = await capture(page, `${output}/crowd-${count}.png`);
    rows.push({ ...row, screenshot });
    console.log(JSON.stringify(row));
  }
  const live = [];
  for (const count of [200, 800]) {
    await page.evaluate((count) => {
      const debug = window.__gameDebug;
      debug.restart(1705, false);
      const game = debug.getModel();
      game.setHidden(true);
      game.mass = 80;
      game.radius = 100;
      game.boosts = { power: 4, rate: 4, range: 4 };
      Object.assign(game.ranks, { area: 5, multi: 5, repeat: 5, chain: 5 });
      game.selections = ['area', 'multi', 'repeat', 'chain'].flatMap((id) =>
        Array.from({ length: 5 }, (_, index) => ({
          time: 0,
          id,
          rank: index + 1,
          rarity: 'common',
          automatic: true,
        })),
      );
      const particles = ['quark', 'muon', 'proton', 'neutron'];
      game.targets = Array.from({ length: count }, (_, id) => {
        const radius = 40 + ((id * 79) % 130),
          angle = id * Math.PI * (3 - Math.sqrt(5));
        const particle = particles[id % 4],
          kind = id % 4 < 2 ? 'small' : 'dense';
        const hp = Math.round(
          game.rules.targets[kind].hp.at(-1) * (particle === 'neutron' ? 1.2 : 1),
        );
        return {
          id,
          x: 180 + Math.cos(angle) * radius,
          y: 260 + Math.sin(angle) * radius,
          radius,
          angle,
          particle,
          kind,
          hp,
          maxHp: hp,
          born: 0,
          xp: particle === 'neutron' ? 6 : game.rules.targets[kind].xp,
          mass: 1,
          size: id % 4 < 2 ? 5 : 8,
          speed: 0,
          turn: 0.12,
        };
      });
      for (const particle of particles) game.counts[particle].generated = count / 4;
      game.combatEnabled = true;
      game.nextSpawn = game.tick + 60 * game.rules.tickRate;
      game.setHidden(false);
      window.__simulationTimes = [];
      const advance = game.advance;
      game.advance = function (ms, ...args) {
        const start = performance.now();
        const result = advance.call(this, ms, ...args);
        if (ms > 0) window.__simulationTimes.push(performance.now() - start);
        return result;
      };
      debug.advance(0);
    }, count);
    await page.waitForTimeout(500);
    const result = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          window.__simulationTimes.length = 0;
          const frames = [];
          let previous, start;
          const sample = (now) => {
            if (!window.__gameDebug) {
              reject(new Error('The game unmounted during the live performance check'));
              return;
            }
            if (previous !== undefined) frames.push(now - previous);
            start ??= now;
            previous = now;
            if (now - start < 3000) requestAnimationFrame(sample);
            else {
              const game = window.__gameDebug.getModel();
              game.setHidden(true);
              const quantile = (values, fraction) =>
                [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
              resolve({
                targets: game.targets.length,
                killed: Object.values(game.counts).reduce((sum, count) => sum + count.killed, 0),
                seconds: game.seconds,
                phase: game.phase,
                effects: game.effects.length,
                hits: game.events.filter((e) => e.kind === 'hit').length,
                simulationMedianMs: quantile(window.__simulationTimes, 0.5),
                simulationP95Ms: quantile(window.__simulationTimes, 0.95),
                frameMedianMs: quantile(frames, 0.5),
                frameP95Ms: quantile(frames, 0.95),
              });
            }
          };
          requestAnimationFrame(sample);
        }),
    );
    assert.equal(result.phase, 'running');
    assert.ok(result.targets <= count);
    assert.ok(result.hits > 0, 'Live crowd must actually execute lightning attacks');
    console.log('LIVE ' + JSON.stringify(result));
    writeFileSync(`${output}/live-${count}.json`, JSON.stringify(result, null, 2));
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    assert.ok(
      await page.evaluate(() =>
        document.fonts.check('12px "Singularity Pixel"', '0123456789 MAX XP'),
      ),
    );
    const screenshot = await capture(page, `${output}/live-${count}.png`);
    await client.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
    live.push({ initialTargets: count, ...result, screenshot });
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    `${output}/browser.json`,
    JSON.stringify({ base, slowdown, rows, live, errors }, null, 2),
  );
} finally {
  await browser.close();
}
