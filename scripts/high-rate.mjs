import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, launchBrowser, observeScene } from './browser-support.mjs';

const output =
  process.argv.find((arg, i) => i > 1 && !arg.startsWith('--')) ??
  'artifacts/performance/high-rate';
const slowdown = Number(process.env.CPU_SLOWDOWN ?? 4);
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const rows = [];
try {
  for (const count of [200, 800]) {
    for (const sound of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await observeScene(page);
      await page.route('**/src/audio/SoundMixer.ts*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            `
          const batch = SoundMixer.prototype.playBatch;
          SoundMixer.prototype.playBatch = function(...args) {
            const result = batch.apply(this, args);
            if (window.__rateStats) window.__rateStats.cues += result;
            return result;
          };`,
        });
      });
      await page.route('**/src/app/GameAudio.ts*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            `
          const audio = GameAudio.prototype.update;
          GameAudio.prototype.update = function(...args) {
            const start = performance.now();
            const result = audio.apply(this, args);
            if (window.__rateStats) window.__rateStats.audio.push(performance.now() - start);
            return result;
          };`,
        });
      });
      await page.goto(base);
      await page.waitForFunction(() => !!window.__gameScene && !!window.__gameDebug);
      if (sound) await page.locator('.title-sound').click();
      await page.evaluate(
        ({ count }) => {
          const stats = (window.__rateStats = {
            simulation: [],
            audio: [],
            scene: [],
            cues: 0,
            hits: 0,
          });
          const debug = window.__gameDebug;
          debug.restart(1705);
          const game = debug.getModel();
          game.setHidden(true);
          game.recordEvents = false;
          game.mass = 80;
          game.radius = 100;
          game.boosts = { power: 4, rate: 9 / game.rules.ratePerRank, range: 4, speed: 4 };
          for (const id of ['pierce', 'multi', 'repeat', 'chain']) {
            game.ranks[id] = 5;
            game.combat.learn(id, 0);
          }
          game.targets = Array.from({ length: count }, (_, id) => {
            const radius = 40 + ((id * 79) % 130);
            const angle = id * Math.PI * (3 - Math.sqrt(5));
            return {
              id,
              x: 180 + Math.cos(angle) * radius,
              y: 260 + Math.sin(angle) * radius,
              radius,
              angle,
              particle: 'quark',
              kind: 'small',
              hp: 1e6,
              maxHp: 1e6,
              born: 0,
              xp: 1,
              mass: 1,
              size: 5,
              speed: 0,
              turn: 0.12,
            };
          });
          game.nextSpawn = 60 * game.rules.tickRate;
          const log = game.log;
          game.log = function (kind, ...args) {
            if (kind === 'hit') stats.hits++;
            return log.call(this, kind, ...args);
          };
          game.setHidden(false);
          const advance = game.advance;
          game.advance = function (...args) {
            const start = performance.now();
            const result = advance.apply(this, args);
            stats.simulation.push(performance.now() - start);
            return result;
          };
          const scene = window.__gameScene;
          const update = scene.drawFrame;
          scene.drawFrame = function (...args) {
            const start = performance.now();
            const result = update.apply(this, args);
            stats.scene.push(performance.now() - start);
            return result;
          };
        },
        { count },
      );
      const client = await page.context().newCDPSession(page);
      await client.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
      await page.waitForTimeout(1000);
      if (process.argv.includes('--profile')) {
        await client.send('Profiler.enable');
        await client.send('Profiler.start');
      }
      const row = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const stats = window.__rateStats;
            stats.simulation.length =
              stats.audio.length =
              stats.scene.length =
              stats.cues =
              stats.hits =
                0;
            const game = window.__gameDebug.getModel();
            const eventStart = game.eventCount;
            const timeStart = game.seconds;
            const frames = [];
            let start, previous;
            const sample = (now) => {
              if (previous !== undefined) frames.push(now - previous);
              start ??= now;
              previous = now;
              if (now - start < 5000) return requestAnimationFrame(sample);
              const quantile = (values, fraction) => {
                const sorted = [...values].sort((a, b) => a - b);
                return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
              };
              const seconds = game.seconds - timeStart;
              game.setHidden(true);
              const result = {
                rate: game.rate,
                seconds,
                phase: game.phase,
                targets: game.targets.length,
                effects: game.effects.length,
                events: game.eventCount - eventStart,
                hits: stats.hits,
                cues: stats.cues,
                frameMedianMs: quantile(frames, 0.5),
                frameP95Ms: quantile(frames, 0.95),
              };
              for (const id of ['simulation', 'audio', 'scene']) {
                result[id + 'MedianMs'] = quantile(stats[id], 0.5);
                result[id + 'P95Ms'] = quantile(stats[id], 0.95);
              }
              resolve(result);
            };
            requestAnimationFrame(sample);
          }),
      );
      if (process.argv.includes('--profile')) {
        const { profile } = await client.send('Profiler.stop');
        writeFileSync(`${output}/cpu-${count}-${sound}.json`, JSON.stringify(profile));
      }
      assert.equal(row.rate, 10);
      assert.equal(row.phase, 'running');
      assert.ok(row.events > 0);
      if (sound)
        assert.equal(row.cues, row.hits, 'Every actual particle contact creates one sound');
      assert.deepEqual(errors, []);
      rows.push({ count, sound, ...row });
      console.log(JSON.stringify(rows.at(-1)));
      await page.close();
    }
  }
  writeFileSync(`${output}/browser.json`, JSON.stringify({ base, slowdown, rows }, null, 2));
} finally {
  await browser.close();
}
