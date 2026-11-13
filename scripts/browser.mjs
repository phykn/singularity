import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, serve } from './launch.mjs';

const scenarios = {
  smoke,
  choices,
  'late-game': lateGame,
  languages: languageLayout,
  performance: crowds,
  audio: audioPreviews,
};
const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const names = !wanted.length || wanted.includes('all') ? Object.keys(scenarios) : wanted;
for (const name of names) if (!scenarios[name]) throw new Error(`unknown scenario: ${name}`);

let server;

// Runs after every helper below is defined.
async function main() {
  const started = performance.now();
  server = await serve();
  const browser = await launchBrowser();
  let failed = false;
  try {
    for (const name of names) {
      const context = await browser.newContext({
        viewport: { width: 375, height: 812 },
        locale: 'en-US',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
      try {
        await scenarios[name](page);
        assert.deepEqual(errors, [], 'page errors');
      } catch (error) {
        failed = true;
        mkdirSync('artifacts', { recursive: true });
        await page.screenshot({ path: `artifacts/browser-${name}.png` }).catch(() => {});
        console.error(`FAIL ${name}`, error);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(
    `${failed ? 'FAILED' : 'OK'} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
  process.exitCode = failed ? 1 : 0;
}

function pass(task, details = {}) {
  console.log('PASS ' + task, JSON.stringify(details));
}

// Every page records the audio contexts it opens.
async function open(page) {
  await page.addInitScript(() => {
    const Native = window.AudioContext,
      contexts = (window.soundContexts = []);
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        contexts.push(this);
      }
    };
  });
  await page.goto(server.url);
  await loaded(page);
}
function loaded(page) {
  return page.waitForFunction(
    () => window.__gameDebug && document.querySelector('.start')?.disabled === false,
  );
}

async function smoke(page) {
  await open(page);
  const title = page.locator('.title-sound');
  assert.equal(await title.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.soundContexts.length), 0);
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForFunction(() => window.soundContexts[0]?.state === 'running', null, {
    timeout: 5000,
  });
  pass('a fresh profile opens audio at START', { state: 'running' });

  const killAt = await page.evaluate(() => {
    const debug = window.__gameDebug;
    for (let second = 1; second <= 30; second++) {
      const game = debug.getGame(),
        from = game.events.length;
      debug.advance(1000);
      if (game.events.slice(from).some((event) => event.kind === 'kill')) return second;
    }
    return null;
  });
  assert.ok(killAt !== null, 'no kill in the first 30 seconds');
  pass('a particle pops within 30 seconds', { second: killAt });

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const setting = page.locator('.pause-panel .title-sound');
  await setting.click();
  assert.equal(await setting.getAttribute('aria-pressed'), 'false');
  await page.reload();
  await loaded(page);
  assert.equal(await title.getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.soundContexts.length), 0);
  pass('sound turned off stays off after a reload');

  const phase = await page.evaluate(() => {
    const debug = window.__gameDebug;
    for (let i = 0; i < 60 && debug.getGame().phase !== 'result'; i++) debug.advance(10000);
    return debug.getGame().phase;
  });
  assert.equal(phase, 'result');
  const result = page.getByRole('dialog', { name: 'Orbit collapse' });
  await result.waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: 'Retry' }).waitFor();
  pass('a loss reaches the result screen');

  // Values exactly as the old game saved them.
  await page.evaluate(() => {
    localStorage.setItem(
      'singularity.record',
      '{"outcome":"success","xp":5200,"level":31,"seed":12345,"collisionTime":1010.5}',
    );
    localStorage.setItem('singularity.beyond', '{"seconds":214.25,"xp":900,"seed":777}');
    localStorage.setItem('singularity.language', '"ko"');
    localStorage.setItem('singularity.sound', 'false');
  });
  await page.reload();
  await loaded(page);
  const records = await page.locator('.preparation .records').innerText();
  assert.match(records, /최고 기록\s+특이점 · 누적 경험치 5200/);
  assert.match(records, /특이점 너머로\s+∞ 03:34 · 추가 경험치 900/);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko');
  assert.equal(await title.getAttribute('aria-pressed'), 'false');
  pass('old saved records, language and sound show on the title', { records });
}

// Opens the next offer through the debug hook and returns its number.
async function offer(page) {
  return page.evaluate(() => {
    const debug = window.__gameDebug;
    for (let i = 0; i < 2400 && !debug.getGame().growth.choice; i++) debug.advance(100);
    return debug.getGame().growth.choice?.number ?? null;
  });
}
const picks = (page) => page.evaluate(() => window.__gameDebug.getGame().growth.selections.length);

async function choices(page) {
  await open(page);
  await page.getByRole('button', { name: 'START' }).click();
  assert.equal(await offer(page), 1);
  const cards = page.locator('.cards button.card');
  await cards.first().waitFor();
  // A tap right after the cards appear is protected.
  const box = await cards.nth(1).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await picks(page), 0, 'an early tap picked a card');
  const ticks = await page.evaluate(() => window.__gameDebug.getGame().elapsedTicks);
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => window.__gameDebug.getGame().elapsedTicks),
    ticks,
    'combat ran during a paused choice',
  );
  await cards.nth(1).click();
  assert.equal(await picks(page), 1);
  pass('an early tap is ignored, a later one picks, combat waits', { ticks });

  assert.equal(await offer(page), 2);
  await cards.first().waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('.cards button.card'));
  await page.keyboard.press('End');
  const focused = await page.evaluate(() => document.activeElement.dataset.upgrade);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  const taken = await page.evaluate(() => window.__gameDebug.getGame().growth.selections.at(-1).id);
  assert.equal(taken, focused);
  pass('keyboard moves between cards and Enter picks', { id: taken });

  assert.equal(await offer(page), 3);
  await page.getByRole('switch').click();
  assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'false');
  await page.waitForFunction(
    () => window.__gameDebug.getGame().growth.selections.length >= 3,
    null,
    {
      timeout: 7000,
    },
  );
  pass('with choice pause off the countdown picks by itself');
}

// Jumps the clock with spawning off: giants, the critical breach and the Higgs by time.
async function lateGame(page) {
  await open(page);
  await page.getByRole('button', { name: 'START' }).click();
  const jump = (seconds, skipGiants = false) =>
    page.evaluate(
      ([seconds, skipGiants]) => {
        const debug = window.__gameDebug,
          game = debug.getGame();
        if (skipGiants) game.giants.count = game.rules.bosses.length;
        game.tick = Math.round(seconds * game.rules.time.tickRate) - 1;
        debug.advance(1000 / game.rules.time.tickRate);
      },
      [seconds, skipGiants],
    );
  await page.evaluate(() => window.__gameDebug.restart(7, false));
  await jump(270);
  const banner = page.locator('.event-banner');
  await banner.filter({ hasText: 'GLUON INBOUND 1/5' }).waitFor({ timeout: 2000 });
  await page.locator('.boss-bar').waitFor();
  pass('the first giant arrives at 4:30 with its banner and health bar');

  await jump(840, true);
  await page.locator('.event-banner[data-kind="critical"]').waitFor({ timeout: 2000 });
  assert.equal(await page.locator('.hud').getAttribute('data-critical'), 'true');
  pass('the critical breach starts at 14:00');

  await jump(930);
  await banner.filter({ hasText: 'HIGGS INBOUND' }).waitFor({ timeout: 2000 });
  await page.getByRole('progressbar', { name: 'Destroy the Higgs' }).waitFor();
  assert.equal(await page.locator('.boss-bar').getAttribute('data-final'), 'true');
  await page.screenshot({ path: 'artifacts/browser-late-game-higgs.png' });
  pass('the Higgs arrives at 15:30 and the singularity meter is full');

  await page.evaluate(() => {
    const debug = window.__gameDebug,
      game = debug.getGame();
    game.damageTarget(
      game.targets.find((t) => t.final),
      1e12,
    );
    for (let i = 0; i < 20 && game.phase !== 'result'; i++) debug.advance(500);
  });
  await page.getByRole('dialog', { name: 'Singularity' }).waitFor({ timeout: 3000 });
  pass('popping the Higgs wins the run');

  await page.getByRole('button', { name: 'BEYOND' }).click();
  await page.evaluate(() => window.__gameDebug.advance(3000));
  await page.getByRole('progressbar', { name: 'Round 7' }).waitFor({ timeout: 2000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('.pause-panel').getByRole('button', { name: 'End run' }).click();
  await page.locator('.pause-panel.is-confirming').getByRole('button', { name: 'End run' }).click();
  const beyond = page.getByRole('dialog', { name: 'BEYOND' });
  await beyond.waitFor({ timeout: 2000 });
  assert.match(await beyond.innerText(), /New best/);
  assert.match(await page.locator('.result .records').innerText(), /BEYOND\s+∞ 00:0\d/);
  pass('beyond the clear, endless mode opens round 7 and quitting records it');
}

// Layout problems a player would see: page overflow, small or offscreen buttons, clipped card
// text, overlapping HUD items and untranslated Korean.
async function layout(page, language, scope = 'body') {
  const issues = await page.evaluate(
    ([language, scope]) => {
      const issues = [],
        root = document.documentElement;
      if (root.scrollWidth > innerWidth || root.scrollHeight > innerHeight)
        issues.push('page overflow');
      for (const button of document.querySelectorAll('button')) {
        if (button.closest('[inert]') || !button.checkVisibility()) continue;
        const r = button.getBoundingClientRect(),
          name = button.getAttribute('aria-label') ?? button.textContent;
        if (button.matches('.slot-inspect')) continue;
        if (r.width < 32 || r.height < 32) issues.push(`small: ${name} ${r.width}x${r.height}`);
        if (
          r.left < -0.5 ||
          r.top < -0.5 ||
          r.right > innerWidth + 0.5 ||
          r.bottom > innerHeight + 0.5
        )
          issues.push('offscreen: ' + name);
      }
      for (const node of document.querySelectorAll(
        '.card-label, .card strong, .card-value, .card-foot, .arena-caption h1, .event-banner',
      ))
        if (node.scrollWidth > node.clientWidth + 1) issues.push('clipped: ' + node.textContent);
      const hud = [...document.querySelectorAll('.hud-top > *')].map((n) =>
        n.getBoundingClientRect(),
      );
      for (let i = 1; i < hud.length; i++)
        if (hud[i].left < hud[i - 1].right - 0.5) issues.push('overlapping HUD');
      if (hud.length && (hud[0].left < 0 || hud.at(-1).right > innerWidth))
        issues.push('offscreen HUD');
      if (language !== 'ko') {
        const text = [...document.querySelectorAll(scope)].map((n) => n.innerText).join(' ');
        const korean = text.match(/[가-힣]+/g)?.filter((word) => word !== '한국어');
        if (korean?.length) issues.push('untranslated: ' + korean.slice(0, 3).join(' '));
      }
      return issues;
    },
    [language, scope],
  );
  const size = page.viewportSize();
  assert.deepEqual(issues, [], `${language} ${size.width}x${size.height}`);
}

// Every language on a small phone, a large phone and a landscape phone: title, help, HUD at its
// widest, cards, pause, and the result.
async function languageLayout(page) {
  const { copy, languages } = await import('../src/ui/text/index.ts');
  const { iconIds } = await import('../src/art/skills.ts');
  await open(page);
  for (const { id, label, html } of languages) {
    const c = copy[id];
    for (const [width, height] of [
      [320, 568],
      [430, 932],
      [812, 375],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.__gameDebug.prepare(10004));
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction((html) => document.documentElement.lang === html, html);
      await layout(page, id);
      await page.getByRole('button', { name: c.guide, exact: true }).click();
      assert.equal(await page.locator('.skill-guide > div').count(), iconIds.length);
      await layout(page, id, '.guide');
      await page.getByRole('button', { name: c.close, exact: true }).click();

      await page.getByRole('button', { name: 'START', exact: true }).click();
      await page.locator('.hud').waitFor();
      // The widest HUD: high level, the Higgs due and mass near the limit.
      await page.evaluate(() => {
        const debug = window.__gameDebug;
        debug.restart(10004, false);
        const game = debug.getGame();
        game.growth.xp = 500000;
        game.mass = 900;
        game.giants.count = game.rules.bosses.length;
        game.tick = game.rules.higgs.time * game.rules.time.tickRate - 1;
        debug.advance(20);
      });
      await layout(page, id);
      await page.evaluate(() => {
        const debug = window.__gameDebug;
        debug.restart(10004);
        for (let i = 0; i < 1200 && !debug.getGame().growth.choice; i++) debug.advance(100);
      });
      await page.locator('.card').first().waitFor();
      await layout(page, id, '.choices');
      if (width === 430) {
        await page.waitForTimeout(200); // the cards fade in
        await page.screenshot({ path: `artifacts/browser-cards-${id}.png` });
      }
      await page.getByRole('button', { name: c.pause, exact: true }).click();
      await layout(page, id, '.pause-panel');
      await page.getByRole('button', { name: c.quit, exact: true }).click();
      await layout(page, id, '.pause-panel');
      await page.getByRole('button', { name: c.back, exact: true }).click();
      await page.getByRole('button', { name: c.resume, exact: true }).click();

      await page.evaluate(() => {
        const debug = window.__gameDebug;
        debug.restart(10004, false);
        const game = debug.getGame();
        game.giants.count = game.rules.bosses.length;
        game.tick = game.rules.higgs.time * game.rules.time.tickRate - 1;
        debug.advance(20);
        game.damageTarget(
          game.targets.find((t) => t.final),
          1e12,
        );
        for (let i = 0; i < 20 && game.phase !== 'result'; i++) debug.advance(500);
      });
      await page.getByRole('heading', { name: c.success, exact: true }).waitFor();
      await layout(page, id, '.result');
    }
    pass(`${id} fits at three sizes`);
  }
}

const quantile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? 0;
const round = (value) => Math.round(value * 100) / 100;

// Counts the cues the mixer accepts into `window.mixed`, patched in through the dev server so
// nothing ships. GameAudio calls playBatch every audible frame, even with nothing to play.
function countSounds(page) {
  return page.route('**/src/audio/SoundMixer.ts*', async (route) => {
    const response = await route.fetch();
    const body =
      (await response.text()) +
      `
window.mixed = { cues: 0, ms: [] };
const playBatch = SoundMixer.prototype.playBatch;
SoundMixer.prototype.playBatch = function (...args) {
  const start = performance.now(), count = playBatch.apply(this, args);
  window.mixed.cues += count;
  window.mixed.ms.push(performance.now() - start);
  return count;
};`;
    await route.fulfill({ response, body });
  });
}

// Wall-clock frame intervals, as the player sees them.
async function frames(page, ms) {
  const intervals = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        let first, last;
        const step = (now) => {
          if (last !== undefined) out.push(now - last);
          first ??= now;
          last = now;
          if (now - first < ms) requestAnimationFrame(step);
          else resolve(out);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
  const total = intervals.reduce((sum, value) => sum + value, 0);
  return {
    frames: intervals.length,
    fps: round((intervals.length * 1000) / total),
    medianMs: round(quantile(intervals, 0.5)),
    p95Ms: round(quantile(intervals, 0.95)),
  };
}

// A fresh run that attacks but no longer spawns, the four linked skills at rank 5, no critical
// hits, the browser's trimmed event log and `count` particles of every kind circling the core.
function crowd(page, count, hp, rate = 1) {
  return page.evaluate(
    ([count, hp, rate]) => {
      const debug = window.__gameDebug;
      debug.restart(1705);
      const game = debug.getGame(),
        kinds = Object.keys(game.rules.particles);
      game.spawner.nextBatch = Infinity;
      game.spawner.pending = [];
      game.recordEvents = false;
      Object.assign(game.growth.ranks, { pierce: 5, multi: 5, repeat: 5, chain: 5 });
      Object.assign(game.growth.boosts, {
        power: 4,
        range: 4,
        rate: (rate - 1) / game.rules.combat.ratePerRank,
      });
      game.growth.refresh();
      game.targets = Array.from({ length: count }, (_, id) => {
        const particle = kinds[id % kinds.length],
          p = game.rules.particles[particle],
          radius = 40 + ((id * 79) % 130),
          angle = id * Math.PI * (3 - Math.sqrt(5));
        return {
          id,
          x: 180 + Math.cos(angle) * radius,
          y: 260 + Math.sin(angle) * radius,
          radius,
          angle,
          particle,
          kind: p.family,
          hp,
          maxHp: hp,
          born: game.time - 1,
          xp: p.xp,
          mass: p.mass,
          size: p.size,
          speed: 0,
          turn: 0.12,
        };
      });
    },
    [count, hp, rate],
  );
}

// A slower phone as a throttled CPU (CPU_SLOWDOWN, default 4).
async function crowds(page) {
  const slowdown = Number(process.env.CPU_SLOWDOWN ?? 4);
  await countSounds(page);
  await open(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });

  // Drawing alone, as the old check measured it: one volley's effects over a frozen crowd.
  await crowd(page, 1600, 1e4);
  await page.evaluate(() => {
    const game = window.__gameDebug.getGame();
    game.combat.fireBasic();
    for (const target of game.targets) delete target.hitAt;
    game.advance = () => {};
    window.gl = { uploads: 0, draws: 0 };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype])
      for (const name of ['texImage2D', 'texSubImage2D', 'drawArrays', 'drawElements']) {
        const native = proto[name];
        proto[name] = function (...args) {
          window.gl[name.startsWith('tex') ? 'uploads' : 'draws']++;
          return native.apply(this, args);
        };
      }
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => (window.gl = { uploads: 0, draws: 0 }));
  const drawn = await frames(page, 2000);
  const gl = await page.evaluate(() => window.gl);
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/browser-performance-1600.png' });
  assert.equal(gl.uploads, 0, 'drawing uploaded textures; damage digits must reuse their atlas');
  assert.ok(drawn.fps >= 57 && drawn.medianMs < 17.5, `1,600 particles: ${JSON.stringify(drawn)}`);
  pass('1,600 particles hold 60 fps', {
    slowdown,
    ...drawn,
    drawsPerFrame: round(gl.draws / drawn.frames),
  });

  for (const count of [200, 800])
    for (const sound of [false, true]) {
      await crowd(page, count, 1e6, 10);
      await page.evaluate(() => {
        const game = window.__gameDebug.getGame(),
          { log, advance } = game;
        window.hits = { count: 0, ms: [] };
        game.log = function (kind, data) {
          if (kind === 'hit') window.hits.count++;
          return log.call(this, kind, data);
        };
        game.advance = function (...args) {
          const start = performance.now();
          advance.apply(this, args);
          window.hits.ms.push(performance.now() - start);
        };
      });
      // The debug restart closes audio; resuming opens it again, as it does for a player.
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      const toggle = page.locator('.pause-panel .title-sound');
      if ((await toggle.getAttribute('aria-pressed')) !== String(sound)) await toggle.click();
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        window.hits = { count: 0, ms: [] };
        window.mixed = { cues: 0, ms: [] };
      });
      const shown = await frames(page, 3000);
      const row = await page.evaluate(() => {
        const game = window.__gameDebug.getGame();
        return {
          rate: game.combat.rate,
          phase: game.phase,
          targets: game.targets.length,
          audio: window.soundContexts.at(-1)?.state,
          hits: window.hits.count,
          cues: window.mixed.cues,
          simulationMs: window.hits.ms,
          mixerMs: window.mixed.ms,
        };
      });
      assert.ok(Math.abs(row.rate - 10) < 1e-9, `attack speed ${row.rate}`);
      assert.equal(row.phase, 'running');
      assert.equal(row.targets, count, 'a durable particle popped');
      assert.ok(row.hits > 0, 'nothing was hit');
      if (sound) assert.equal(row.audio, 'running');
      assert.equal(row.cues, sound ? row.hits : 0, 'hits and sounded contacts differ');
      pass(`x10 attack speed on ${count} particles, sound ${sound ? 'on' : 'off'}`, {
        hits: row.hits,
        cues: row.cues,
        ...shown,
        simulationMedianMs: round(quantile(row.simulationMs, 0.5)),
        mixerMedianMs: round(quantile(row.mixerMs, 0.5)),
      });
    }
}

// Offline previews, events in seconds. `count` sends that many hits as one batch and `stop`
// stops every voice; `quiet` spans must render silent.
const clips = [
  {
    name: 'combat',
    seconds: 12,
    events: Array.from({ length: 90 }, (_, i) => {
      const at = 0.3 + i * 0.115 + Math.sin(i * 1.7) * 0.015;
      return [{ kind: 'hit', at }, ...(i % 18 ? [] : [{ kind: 'wave', at: at + 0.05 }])];
    }).flat(),
  },
  { name: 'qte', seconds: 4, events: [{ kind: 'rhythm-complete', at: 1.5 }] },
  // Every short cue in turn: contact, the five pop styles, the three particle keys and the rest.
  {
    name: 'textures',
    seconds: 10,
    events: [
      'preview',
      'hit',
      'crit',
      'pop',
      'slam',
      'roll',
      'enter',
      'brush',
      'space',
      'lift',
      'double',
      'build',
      'thunder',
      'rare',
      'wave',
      'charged',
      'collision',
      'rhythm-complete',
    ].map((kind, i) => ({ kind, at: 0.25 + i * 0.5 })),
  },
  {
    name: 'distance',
    seconds: 3,
    events: [
      { kind: 'hit', at: 0.25, space: { pan: -0.3, depth: 0 } },
      { kind: 'hit', at: 1.25, space: { pan: 0.3, depth: 1 } },
      { kind: 'rhythm-complete', at: 2.25, space: { pan: 0.3, depth: 1 } },
    ],
  },
  {
    name: 'singularity',
    seconds: 7,
    events: [
      { kind: 'singularity', at: 0.25 },
      { stop: true, at: 1.7 },
      { kind: 'beyond-contract', at: 4.1 },
      { stop: true, at: 4.65 },
      { kind: 'beyond-open', at: 4.8 },
    ],
    quiet: [
      [1.74, 4.09],
      [4.69, 4.79],
      [5.45, 6.95],
    ],
  },
  {
    name: 'pause',
    seconds: 2,
    events: [
      { kind: 'hit', at: 0.2 },
      { kind: 'hit', at: 0.21 },
      { stop: true, at: 0.23 },
      { kind: 'hit', at: 1.2 },
    ],
    quiet: [[0.28, 1.15]],
  },
  { name: 'burst', seconds: 2, events: [{ kind: 'hit', at: 0.2, count: 480 }] },
  {
    name: 'contacts',
    seconds: 8,
    events: [1, 2, 3, 4, 16, 480]
      .map((count, i) => ({ kind: 'hit', count, at: 0.25 + i }))
      .concat(Array.from({ length: 45 }, (_, i) => ({ kind: 'hit', count: 16, at: 6.3 + i / 60 }))),
  },
  {
    name: 'overlap',
    seconds: 6,
    events: Array.from({ length: 720 }, (_, i) => ({
      kind: ['hit', 'hit', 'hit', 'hit', 'wave', 'rhythm-complete'][i % 6],
      at: 0.2 + i / 160,
    })),
  },
];

async function renderClip({ seconds, events, quiet = [] }) {
  const { SoundMixer } = await import('/src/audio/SoundMixer.ts');
  const { pcm16Base64 } = await import('/scripts/audio-pcm.mjs');
  const rate = 48000,
    ctx = new OfflineAudioContext(2, seconds * rate, rate),
    mixer = new SoundMixer(ctx, 1701);
  let played = 0;
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    if (event.stop) mixer.stop(event.at);
    else if (event.count) {
      const cues = Array.from({ length: event.count }, (_, i) => ({
        kind: event.kind,
        space: { pan: Math.sin(i) * 0.3, depth: 0 },
      }));
      played += mixer.playBatch(cues, event.at);
    } else played += mixer.play(event.kind, event.at, event.space);
  }
  const audio = await ctx.startRendering(),
    channels = [audio.getChannelData(0), audio.getChannelData(1)];
  let peak = 0,
    sum = 0,
    finite = true,
    loud = 0;
  for (const data of channels) {
    for (const value of data) {
      finite &&= Number.isFinite(value);
      peak = Math.max(peak, Math.abs(value));
      sum += value * value;
    }
    for (const [from, to] of quiet)
      for (let i = Math.ceil(from * rate); i < to * rate; i++)
        loud = Math.max(loud, Math.abs(data[i]));
  }
  mixer.dispose();
  const rms = Math.sqrt(sum / (2 * audio.length));
  return { played, finite, peak, rms, loud, pcm: pcm16Base64(channels) };
}

function writeWav(path, base64) {
  const pcm = Buffer.from(base64, 'base64'),
    head = Buffer.alloc(44);
  head.write('RIFF');
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(2, 22); // stereo
  head.writeUInt32LE(48000, 24);
  head.writeUInt32LE(48000 * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([head, pcm]));
}

// WAV previews in artifacts/audio for listening, then a live burst through the game's own audio.
async function audioPreviews(page) {
  await countSounds(page);
  await open(page);
  mkdirSync('artifacts/audio', { recursive: true });
  const report = [];
  for (const clip of clips) {
    const { pcm, ...result } = await page.evaluate(renderClip, clip);
    const cues = clip.events.reduce((n, event) => n + (event.stop ? 0 : (event.count ?? 1)), 0);
    assert.equal(result.played, cues, `${clip.name} dropped cues`);
    assert.ok(result.finite, `${clip.name} has non-finite samples`);
    assert.ok(result.peak > 0 && result.peak < 0.95, `${clip.name} peaks at ${result.peak}`);
    assert.ok(result.loud <= 1e-5, `${clip.name} sounds where it stops: ${result.loud}`);
    writeWav(`artifacts/audio/${clip.name}.wav`, pcm);
    report.push({ name: clip.name, seconds: clip.seconds, ...result });
  }
  writeFileSync('artifacts/audio/report.json', JSON.stringify(report, null, 2) + '\n');
  pass(
    'previews in artifacts/audio stay under 0.95 and go silent when stopped',
    Object.fromEntries(report.map(({ name, peak }) => [name, round(peak)])),
  );

  // Each hit kills its particle beside a firing event; only the hit may sound.
  await page.evaluate(() => {
    const live = (window.sources = { started: 0, active: 0 }),
      proto = window.AudioContext.prototype,
      create = proto.createBufferSource;
    proto.createBufferSource = function () {
      const source = create.call(this),
        { start, disconnect } = source;
      let playing = false;
      const release = () => {
        if (playing) live.active--;
        playing = false;
      };
      source.start = function (...args) {
        live.started++;
        live.active++;
        playing = true;
        source.addEventListener('ended', release, { once: true });
        return start.apply(this, args);
      };
      source.disconnect = function (...args) {
        release();
        return disconnect.apply(this, args);
      };
      return source;
    };
    window.__gameDebug.restart(17, false);
    window.mixed = { cues: 0, ms: [] };
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => window.mixed.ms.length > 0, null, { timeout: 5000 });
  await page.evaluate(async () => {
    const { particleIds } = await import('/src/game/rules.ts');
    const styles = ['tap', 'burst', 'domino', 'release', 'sweep'],
      game = window.__gameDebug.getGame();
    window.mixed.cues = window.sources.started = 0;
    for (let id = 0; id < 480; id++) {
      const at = { id, x: 180 + Math.sin(id) * 100, y: 260 + Math.cos(id) * 100 },
        particle = particleIds[id % particleIds.length];
      game.log('hit', { ...at, kind: 'small', particle, damage: 10 });
      game.log('kill', { ...at, kind: 'small', particle, style: styles[id % 5], delay: 0 });
      game.log('skill-effect', { id: 'strike', rank: 1 });
    }
  });
  await page.waitForFunction(() => window.mixed.cues >= 480, null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(
    () => window.sources.active === 0 && window.soundContexts[0].state === 'suspended',
    null,
    { timeout: 3000 },
  );
  const live = await page.evaluate(() => ({
    cues: window.mixed.cues,
    sources: window.sources.started,
  }));
  assert.equal(live.cues, 480, 'a hit went unheard or sounded twice');
  assert.equal(live.sources, 1, 'kills or firing added sounds of their own');
  pass('a live burst of 480 kills sounds every hit once, in one source, and pause silences it', {
    ...live,
    activeAfterPause: 0,
  });
}

await main();
