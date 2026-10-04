import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { base, capture, launchBrowser } from './browser-support.mjs';
import { rules, skillIds, statIds, rarityIds } from '../src/game/rules.ts';
import { copy } from '../src/ui/i18n.ts';
import { skillColor } from '../src/render/palette.ts';

mkdirSync('artifacts/screens', { recursive: true });
const browser = await launchBrowser();
const errors = [],
  checks = [];
const report = (task, details) => {
  checks.push({ task, details });
  console.log('PASS ' + task, JSON.stringify(details));
};
const pageFor = async (width, height, seed = 10004) => {
  const page = await browser.newPage({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  if (base.includes('ngrok'))
    await page.setExtraHTTPHeaders({ 'ngrok-skip-browser-warning': 'true' });
  await page.goto(base + '/?seed=' + seed);
  await page.waitForSelector('canvas');
  await page.evaluate(() => document.fonts.ready);
  if (!process.argv.includes('--production'))
    await page.waitForFunction(() => !!window.__gameDebug);
  return page;
};
const inspect = async (page) => {
  const value = await page.evaluate(() => {
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const buttons = [...document.querySelectorAll('button')]
      .filter((b) => !b.closest('[inert]') && b.getBoundingClientRect().width > 0)
      .map((b) => ({ text: b.textContent.trim(), ...rect(b) }));
    return {
      viewport: [innerWidth, innerHeight],
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      canvas: rect(document.querySelector('canvas')),
      buttons,
    };
  });
  assert.deepEqual(value.scroll, value.viewport);
  for (const b of value.buttons) {
    assert.ok(b.w >= 43.9 && b.h >= 43.9, 'Small touch target: ' + b.text);
    assert.ok(
      b.x >= -0.1 &&
        b.y >= -0.1 &&
        b.x + b.w <= value.viewport[0] + 0.1 &&
        b.y + b.h <= value.viewport[1] + 0.1,
      'Offscreen: ' + b.text,
    );
  }
  assert.ok(value.canvas.w > 0 && value.canvas.h > 0);
  return value;
};
const inspectCards = async (page) => {
  const clipped = await page
    .locator('.card-value, .card strong, .card-label')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const bounds = node.getBoundingClientRect(),
            card = node.closest('.card'),
            outer = card.getBoundingClientRect(),
            css = getComputedStyle(card);
          return (
            node.scrollWidth > node.clientWidth + 1 ||
            node.scrollHeight > node.clientHeight + 1 ||
            bounds.left < outer.left + parseFloat(css.paddingLeft) - 1 ||
            bounds.right > outer.right - parseFloat(css.paddingRight) + 1
          );
        })
        .map((node) => node.textContent),
    );
  assert.deepEqual(clipped, [], 'Card text must fit inside its padded content area');
};
const snapshot = (page) =>
  page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    return {
      phase: g.phase,
      seed: g.seed,
      time: g.time,
      seconds: g.seconds,
      xp: g.xp,
      mass: g.mass,
      radius: g.radius,
      level: g.level,
      ranks: g.ranks,
      boosts: g.boosts,
      rarities: g.rarities,
      score: g.score,
      rushSpawns: g.rushSpawns,
      choice: g.choice,
      selections: g.selections,
      paused: g.paused,
      result: g.result,
    };
  });
const advance = (page, ms) => page.evaluate((ms) => window.__gameDebug.advance(ms), ms);
const firstChoice = async (page) => {
  await page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    for (let i = 0; i < 120 && !g.choice; i++) window.__gameDebug.advance(250);
    if (!g.choice) throw new Error('No growth choice within 30 seconds');
  });
  await page.locator('.card').first().waitFor();
};
const screenshot = async (page, name) => {
  await page.waitForTimeout(120);
  await capture(page, 'artifacts/screens/' + name + '.png');
};

const rarityFlow = async () => {
  const page = await pageFor(375, 812);
  await page.evaluate(() => {
    window.__gameDebug.restart(21, false);
    window.__gameDebug.xp(18);
    const g = window.__gameDebug.getModel();
    g.choice.cards = [
      { id: 'multi', rarity: 'legendary' },
      { id: 'chain', rarity: 'epic' },
      { id: 'area', rarity: 'rare' },
    ];
    window.__gameDebug.advance(0);
  });
  await page.locator('.card[data-rarity="legendary"]').waitFor();
  await inspectCards(page);
  await screenshot(page, 'legendary-choice');
  await page.locator('.card[data-rarity="legendary"]').click();
  const selected = await snapshot(page);
  assert.equal(selected.rarities.multi, 'legendary');
  assert.equal(selected.ranks.multi, 1);
  assert.equal(
    await page.evaluate(() => window.__gameDebug.getModel().forms.multi.count),
    rules.skills.multi.primaries[1] + rules.rarity.legendary.extra,
  );
  await page.locator('.slot[data-rarity="legendary"]').waitFor();
  await screenshot(page, 'legendary-acquired');
  report('legendary card selection applies its branch bonus and keeps its visible identity', {
    rank: selected.ranks.multi,
    rarity: selected.rarities.multi,
    branches: rules.skills.multi.primaries[1] + rules.rarity.legendary.extra,
  });
  await page.close();
};

const audioFlow = async () => {
  const page = await pageFor(375, 812);
  await page.evaluate(() => {
    const Native = window.AudioContext;
    const trial = (window.audioTrial = { contexts: [], requests: [] });
    window.AudioContext = class extends Native {
      constructor() {
        super();
        trial.contexts.push(this);
      }
      async resume() {
        // Keep the native call inside the click gesture; defer only completion.
        const resumed = super.resume();
        await new Promise((resolve, reject) => trial.requests.push({ resolve, reject }));
        return resumed;
      }
    };
  });
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const sound = () => page.locator('.setting-row').first();
  const pressed = () => sound().getAttribute('aria-pressed');
  const settle = async (index, fail = false) => {
    await page.waitForFunction((index) => !!window.audioTrial.requests[index], index);
    await page.evaluate(
      ({ index, fail }) => {
        const request = window.audioTrial.requests[index];
        if (fail) request.reject(new Error('Audio unavailable'));
        else request.resolve();
      },
      { index, fail },
    );
    await page.waitForTimeout(100);
  };
  await sound().click();
  assert.equal(await pressed(), 'true');
  await sound().click();
  await settle(0);
  assert.equal(await pressed(), 'false');
  assert.equal(await page.evaluate(() => window.audioTrial.contexts[0].state), 'suspended');
  await sound().click();
  await sound().click();
  await sound().click();
  await settle(2);
  await page.waitForFunction(() => window.audioTrial.contexts[0].state === 'running');
  await settle(1, true);
  assert.equal(await pressed(), 'true');
  assert.equal(await page.locator('.setting-notice').count(), 0);
  assert.equal(await page.evaluate(() => window.audioTrial.contexts[0].state), 'running');
  await sound().click();
  await sound().click();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: 'START' }).click();
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await settle(3);
  await settle(4);
  assert.equal(await pressed(), 'true');
  assert.equal(await page.evaluate(() => window.audioTrial.contexts[0].state), 'suspended');
  assert.equal(await page.locator('.setting-notice').count(), 0);
  await sound().click();
  await sound().click();
  await settle(5, true);
  assert.equal(await pressed(), 'false');
  await page.getByRole('dialog').getByText(copy.ko.audioFailed, { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('singularity.settings')).sound),
    false,
  );
  await screenshot(page, 'audio-recovery');
  report('delayed audio respects rapid toggles, newer requests, pause and actual failures', {
    requests: 6,
    savedSound: false,
  });
  await page.close();
};

const skillFlow = async () => {
  const skillsPage = await pageFor(375, 812);
  for (const id of skillIds) {
    const damage = await skillsPage.evaluate((id) => {
      window.__gameDebug.restart(1, false);
      const g = window.__gameDebug.getModel();
      g.ranks[id] = 5;
      g.rarities[id] = 'epic';
      g.targets = Array.from({ length: 24 }, (_, i) => {
        const x = 185 + (i % 6) * 16,
          y = 108 + Math.floor(i / 6) * 16;
        const hp = id === 'burst' && i === 6 ? 2 : 100;
        return {
          id: i,
          x,
          y,
          hp,
          maxHp: hp,
          kind: 'small',
          particle: 'quark',
          born: 0,
          xp: 1,
          mass: 1,
          size: 5,
          radius: Math.hypot(x - 180, y - 260),
          angle: Math.atan2(y - 260, x - 180),
          speed: 0,
          turn: 0,
        };
      });
      g.counts.quark.generated = g.targets.length;
      if (['strike', 'wave', 'whip', 'focus'].includes(id)) g.combat.fireSkill(id);
      else g.combat.fireBasic();
      window.__gameDebug.advance(['wave', 'whip'].includes(id) ? 200 : 100);
      g.setHidden(true);
      return g.damageNumbers.map((n) => n.value);
    }, id);
    assert.ok(damage.length > 0, 'No visible damage for ' + id);
    await screenshot(skillsPage, 'skill-' + id);
  }
  report('all ten lightning skills render real impacts and damage', { skills: skillIds });
  await skillsPage.close();
};

const visualFlow = async () => {
  const page = await pageFor(375, 812);
  for (const id of skillIds) {
    const ranks = [];
    for (const rank of [1, 5]) {
      const result = await page.evaluate(
        ({ id, rank }) => {
          window.__gameDebug.restart(17, false);
          const g = window.__gameDebug.getModel();
          g.ranks[id] = rank;
          const particles = ['quark', 'muon', 'proton', 'neutron'];
          g.targets = Array.from({ length: 24 }, (_, i) => {
            const radius = (id === 'wave' ? 18 : 54) + Math.floor(i / 8) * 12;
            const angle = -1.3 + (i % 8) * 0.37;
            const x = 180 + Math.cos(angle) * radius,
              y = 128 + Math.sin(angle) * radius;
            return {
              id: i,
              x,
              y,
              hp: 100,
              maxHp: 100,
              kind: i % 4 < 2 ? 'small' : 'dense',
              particle: particles[i % 4],
              born: 0,
              xp: 1,
              mass: 1,
              size: 5,
              radius: Math.hypot(x - 180, y - 260),
              angle: Math.atan2(y - 260, x - 180),
              speed: 0,
              turn: 0,
            };
          });
          if (id === 'burst') {
            const nearest = [...g.targets].sort(
              (a, b) => Math.hypot(a.x - 180, a.y - 128) - Math.hypot(b.x - 180, b.y - 128),
            )[0];
            nearest.hp = nearest.maxHp = 2;
          }
          if (['strike', 'wave', 'whip', 'focus'].includes(id)) g.combat.fireSkill(id);
          else g.combat.fireBasic();
          window.__gameDebug.advance(
            ['wave', 'whip'].includes(id) ? 175 : id === 'repeat' ? 100 : 50,
          );
          g.setHidden(true);
          return {
            effects: g.effects
              .filter((fx) => fx.source === id)
              .map((fx) => ({ rank: fx.rank, radius: fx.radius, width: fx.width })),
            hits: g.events.filter((event) => event.kind === 'hit').length,
          };
        },
        { id, rank },
      );
      assert.ok(
        result.effects.length > 0 && result.hits > 0,
        id + ' must produce an actual visible attack',
      );
      assert.ok(result.effects.every((fx) => fx.rank === rank));
      const iconColor = await page
        .locator('.slot[data-skill="' + id + '"] svg')
        .evaluate((svg) => svg.style.color);
      const expectedColor = await page.evaluate((color) => {
        const node = document.createElement('span');
        node.style.color = color;
        return node.style.color;
      }, skillColor(id));
      assert.equal(iconColor, expectedColor);
      await screenshot(page, `visual-${id}-rank-${rank}`);
      ranks.push(result);
    }
    if (['multi', 'chain', 'burst', 'strike'].includes(id))
      assert.ok(ranks[1].hits > ranks[0].hits);
    if (['area', 'pierce', 'wave', 'whip'].includes(id))
      assert.ok(
        ranks[1].effects[0].radius > ranks[0].effects[0].radius ||
          ranks[1].effects[0].width > ranks[0].effects[0].width,
      );
  }
  report('all ten skills retain their identity and show actual growth from rank one to five', {
    skills: skillIds,
  });
  for (const [width, height] of [
    [375, 812],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    for (const id of [...skillIds, ...statIds]) {
      await page.evaluate((id) => {
        window.__gameDebug.restart(17, false);
        const g = window.__gameDebug.getModel();
        if (id in g.ranks) g.ranks[id] = id === 'chain' ? 4 : 1;
        else g.boosts[id] = 1;
        g.choice = {
          number: 1,
          opened: g.time,
          deadline: g.time + 8,
          cards: [{ id, rarity: 'rare' }],
        };
        window.__gameDebug.advance(0);
      }, id);
      await page.locator('.card').first().click();
      const feedback = page.locator('.upgrade-feedback');
      await feedback.waitFor();
      await page.evaluate(() => {
        window.__gameDebug.getModel().setHidden(true);
        window.__gameDebug.advance(0);
      });
      assert.equal(await feedback.getAttribute('data-skill'), id);
      const rank = id === 'chain' ? 5 : 2;
      assert.ok((await feedback.innerText()).includes(`${rank - 1} → ${rank}`));
      if (id === 'chain') assert.equal(await page.locator('.slot-max').innerText(), 'MAX');
      const box = await feedback.boundingBox();
      assert.ok(
        box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height,
      );
      assert.equal(await feedback.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
      await screenshot(page, `upgrade-${id}-${width}x${height}`);
      await page.evaluate(() => {
        const g = window.__gameDebug.getModel();
        g.setHidden(false);
        g.setManualPause(true);
        window.__gameDebug.advance(5000);
      });
      assert.equal(await feedback.count(), 1, 'A manual pause preserves upgrade feedback');
      await page.evaluate(() => {
        window.__gameDebug.getModel().setManualPause(false);
        window.__gameDebug.advance(2100);
        window.__gameDebug.getModel().setHidden(true);
      });
      assert.equal(await feedback.count(), 0, 'Feedback clears after its game-time interval');
    }
  }
  report(
    'manual upgrades confirm every skill and stat, remain legible in both orientations and expire after play resumes',
    { upgrades: 13, viewports: 2 },
  );
  await page.close();
};

const interfaceFlow = async () => {
  const page = await pageFor(375, 812);
  await page.getByRole('button', { name: copy.ko.guide, exact: true }).click();
  assert.deepEqual(await page.locator('.particle-guide > div').allTextContents(), [
    'q쿼크',
    'μ뮤온',
    'p양성자',
    'n중성자',
  ]);
  await screenshot(page, 'particle-guide');
  await page.getByRole('button', { name: copy.ko.close, exact: true }).click();
  await page.evaluate(() => {
    window.__gameDebug.restart(1, false);
    const g = window.__gameDebug.getModel();
    const x = 200,
      y = 260;
    g.targets = [
      {
        id: 0,
        x,
        y,
        hp: 1000,
        maxHp: 1000,
        kind: 'dense',
        particle: 'proton',
        born: 0,
        xp: 5,
        mass: 5,
        size: 8,
        radius: Math.hypot(x - 180, y - 260),
        angle: Math.atan2(y - 260, x - 180),
        speed: 0,
        turn: 0,
      },
    ];
    for (const id of ['strike', 'area', 'burst']) {
      g.choice = {
        number: g.selections.length + 1,
        cards: [{ id, rarity: 'common' }],
        opened: g.time,
        deadline: g.time + 8,
      };
      g.select(id);
    }
    window.__gameDebug.advance(100);
    g.setHidden(true);
  });
  await page.waitForTimeout(120);
  const strike = page.locator('.slot[data-skill="strike"]');
  assert.equal(await strike.getAttribute('data-fired'), 'true');
  assert.deepEqual(
    await page
      .locator('.slot[data-skill]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.skill)),
    ['strike', 'area', 'burst'],
  );
  assert.equal(await page.locator('.slot[data-skill="area"]').getAttribute('data-mode'), 'linked');
  assert.equal(await page.locator('.slot[data-skill="burst"] .slot-fill').count(), 0);
  const bounds = async () => {
    const fill = await strike.locator('.slot-fill').boundingBox();
    const value = Number(await strike.getAttribute('aria-valuenow'));
    const engine = await page.evaluate(() =>
      Math.floor(window.__gameDebug.getModel().combat.status('strike').progress * 100),
    );
    assert.equal(value, engine);
    return { fill, value };
  };
  const before = await bounds();
  const appearance = () =>
    strike.evaluate((node) => {
      const style = getComputedStyle(node),
        inner = getComputedStyle(node, '::after'),
        icon = getComputedStyle(node.querySelector('.slot-art'));
      return [style.borderColor, style.boxShadow, inner.content, icon.color, icon.animationName];
    });
  const quiet = await appearance();
  assert.equal(quiet[1], 'none');
  assert.equal(quiet[2], 'none');
  assert.equal(quiet[4], 'none');
  const step = async (ms) => {
    await page.evaluate((ms) => {
      const g = window.__gameDebug.getModel();
      g.setHidden(false);
      window.__gameDebug.advance(ms);
      g.setHidden(true);
    }, ms);
    await page.waitForTimeout(120);
  };
  await step(1800);
  const after = await bounds();
  assert.deepEqual(await appearance(), quiet);
  assert.ok(after.value > before.value && after.fill.y < before.fill.y);
  assert.ok(Math.abs(after.fill.y + after.fill.height - before.fill.y - before.fill.height) < 0.1);
  await screenshot(page, 'cooldown-fill');
  await page.evaluate(() => window.__gameDebug.advance(10000));
  await page.waitForTimeout(120);
  assert.deepEqual(await bounds(), after);
  await step(1800);
  const fired = await bounds();
  assert.ok(fired.value < after.value);
  assert.equal(await strike.getAttribute('data-fired'), 'true');
  assert.deepEqual(await appearance(), quiet);
  await page.evaluate(() => {
    window.__gameDebug.getModel().ranks.strike = 5;
    window.__gameDebug.advance(0);
  });
  await strike.locator('.slot-max').waitFor();
  assert.equal(await strike.locator('.slot-max').innerText(), 'MAX');
  assert.equal(await strike.locator('.rank').count(), 0);
  await screenshot(page, 'cooldown-fired');
  await page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    g.mass = 1000;
    g.radius = g.core + 4;
    g.setHidden(false);
    window.__gameDebug.advance(100);
    g.setHidden(true);
  });
  await page.waitForTimeout(120);
  assert.equal(await strike.getAttribute('data-fired'), 'false');
  assert.equal(await page.locator('.arena').innerText(), copy.ko.collapse);
  assert.equal(
    await page.locator('.arena [role="status"]').evaluate((n) => getComputedStyle(n).clipPath),
    'inset(50%)',
  );
  report(
    'quiet cooldown fills keep their timing without flashing borders and maxed skills show MAX',
    {
      before: before.value,
      recharging: after.value,
      fired: fired.value,
      conditionalHasNoFill: true,
      unchangedAppearance: quiet,
    },
  );
  await page.evaluate(() => {
    window.__gameDebug.restart(1, false);
    window.__gameDebug.advance(600000);
    window.__gameDebug.getModel().setHidden(true);
  });
  await page.waitForTimeout(120);
  assert.equal((await snapshot(page)).phase, 'running');
  assert.equal(await page.locator('.hud time').innerText(), '10:00');
  assert.equal(
    await page
      .locator('.xp-status')
      .innerText()
      .then((t) => t.includes('MAX')),
    false,
  );
  await screenshot(page, 'uncapped-clock');
  await page.evaluate(() => {
    const g = window.__gameDebug.getModel();
    g.setHidden(false);
    g.ranks = { ...g.ranks, area: 5, chain: 5, wave: 5, strike: 5 };
    g.boosts = { power: 6, rate: 6, accel: 6 };
    g.selections = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      id: ['area', 'chain', 'wave', 'strike'][i % 4],
      rank: Math.floor(i / 4) + 1,
      rarity: 'common',
      automatic: false,
    }));
    window.__gameDebug.xp(g.rules.energyGoal - 1);
    g.setHidden(true);
  });
  await page.locator('.card').first().waitFor();
  assert.deepEqual((await snapshot(page)).choice.cards.map((c) => c.id).sort(), [
    'accel',
    'power',
    'rate',
  ]);
  assert.equal(await page.locator('.slot-max').count(), 4);
  await inspect(page);
  await inspectCards(page);
  await screenshot(page, 'max-skills-stat-choice');
  await page.evaluate(() => window.__gameDebug.getModel().setHidden(false));
  const id = (await snapshot(page)).choice.cards[1].id;
  await page.locator('.card').nth(1).click();
  assert.equal((await snapshot(page)).boosts[id], 7);
  report(
    'elapsed clock passes ten minutes and full skill slots still offer repeatable stat upgrades',
    { upgradedStat: id, rank: 7 },
  );
  await page.close();
};

try {
  if (process.argv.includes('--audio')) {
    await audioFlow();
  } else if (process.argv.includes('--skills')) {
    await skillFlow();
  } else if (process.argv.includes('--visuals')) {
    await visualFlow();
  } else if (process.argv.includes('--interface')) {
    await interfaceFlow();
  } else if (process.argv.includes('--rarity')) {
    await rarityFlow();
  } else if (process.argv.includes('--production')) {
    const page = await pageFor(375, 812);
    assert.equal(await page.evaluate(() => typeof window.__gameDebug), 'undefined');
    await page.getByRole('button', { name: 'START' }).click();
    await page.locator('.hud').waitFor();
    await inspect(page);
    await screenshot(page, 'production');
    report('production starts without debug hooks', { base });
    await page.getByRole('button', { name: copy.ko.pause, exact: true }).click();
    const pausedHud = await page.locator('.hud').innerText();
    const pausedXp = await page.locator('.xp-status').innerText();
    await page.reload();
    await page.getByRole('button', { name: copy.ko.resume, exact: true }).waitFor();
    assert.equal(await page.locator('.hud').innerText(), pausedHud);
    assert.equal(await page.locator('.xp-status').innerText(), pausedXp);
    assert.equal(await page.evaluate(() => typeof window.__gameDebug), 'undefined');
    await page.getByRole('button', { name: copy.ko.resume, exact: true }).click();
    await page.locator('.pause-panel').waitFor({ state: 'hidden' });
    report('production reload restores the saved run and manual pause', { xp: pausedXp });
    await page.close();
  } else if (process.argv.includes('--realtime')) {
    const page = await pageFor(375, 812, 20000);
    await page.getByRole('button', { name: 'START' }).click();
    const started = Date.now(),
      samples = [];
    let previous = 0;
    while (!(await snapshot(page)).result && Date.now() - started < 640000) {
      await page.waitForTimeout(30000);
      const s = await snapshot(page);
      assert.ok(s.seconds >= previous, 'The page restarted during the run');
      previous = s.seconds;
      samples.push({
        wallSeconds: (Date.now() - started) / 1000,
        time: s.time,
        seconds: s.seconds,
        xp: s.xp,
        mass: s.mass,
        radius: s.radius,
        phase: s.phase,
        choices: s.selections.length,
      });
      console.log(JSON.stringify(samples.at(-1)));
    }
    const s = await snapshot(page);
    // Compare clocks inside Chrome: Node's trigonometric rounding can change a tied target choice.
    const expected = await page.evaluate(async () => {
      const { Game } = await import('/src/game/model.ts');
      const game = new Game(20000);
      game.start();
      game.advance(610000);
      return game.result;
    });
    await screenshot(page, 'realtime-result');
    writeFileSync(
      'artifacts/realtime.json',
      JSON.stringify(
        {
          viewport: [375, 812],
          seed: 20000,
          elapsedWallSeconds: (Date.now() - started) / 1000,
          samples,
          result: s.result,
          expected,
          errors,
        },
        null,
        2,
      ),
    );
    assert.equal(s.result?.outcome, 'success');
    assert.equal(s.result.trigger, 'energy');
    assert.deepEqual(s.result, expected);
    assert.deepEqual(errors, []);
    report('normal clock: full autonomous game', {
      wallSeconds: (Date.now() - started) / 1000,
      result: s.result.outcome,
      xp: s.xp,
    });
  } else {
    await audioFlow();
    await rarityFlow();
    for (const [width, height] of [
      [360, 640],
      [375, 812],
      [320, 568],
      [430, 932],
      [812, 375],
      [568, 320],
    ]) {
      const page = await pageFor(width, height),
        name = width + 'x' + height;
      await inspect(page);
      await screenshot(page, 'ready-' + name);
      assert.equal((await snapshot(page)).seed, 10004);
      await page.getByRole('button', { name: '도움말', exact: true }).click();
      await inspect(page);
      assert.equal(
        await page.locator('.skill-guide > div').count(),
        skillIds.length + statIds.length,
      );
      await page.getByRole('button', { name: '닫기', exact: true }).click();
      await page.getByRole('button', { name: 'START' }).click();
      const playing = await inspect(page);
      assert.equal(await page.locator('.choices').count(), 0);
      if (height > width) assert.ok(playing.canvas.h / height >= 0.7);
      await firstChoice(page);
      await screenshot(page, 'cards-' + name);
      const cards = await inspect(page);
      assert.deepEqual(cards.canvas, playing.canvas);
      assert.equal(await page.locator('.card').count(), 3);
      await inspectCards(page);
      const chosen = (await snapshot(page)).choice.cards[1].id;
      await page.locator('.card').nth(1).click();
      assert.equal((await snapshot(page)).selections[0].id, chosen);
      await page.getByRole('button', { name: '일시정지', exact: true }).click();
      const frozen = await snapshot(page);
      await advance(page, 10000);
      assert.deepEqual(await snapshot(page), frozen);
      await inspect(page);
      await screenshot(page, 'pause-' + name);
      await page.getByRole('button', { name: '계속하기' }).click();
      await advance(page, 1000);
      assert.ok((await snapshot(page)).time > frozen.time);
      await page.getByRole('button', { name: '일시정지', exact: true }).click();
      await page.getByRole('button', { name: '그만하기', exact: true }).click();
      await page.getByRole('button', { name: '그만하기', exact: true }).click();
      const reset = await snapshot(page);
      assert.equal(reset.phase, 'ready');
      assert.equal(reset.seed, 10004);
      assert.equal(reset.xp, 0);
      assert.equal(reset.mass, 0);
      await page.evaluate(() => window.__gameDebug.restart(20000));
      await advance(page, 610000);
      await page.getByRole('heading', { name: copy.ko.success, exact: true }).waitFor();
      await inspect(page);
      await screenshot(page, 'result-' + name);
      assert.equal((await snapshot(page)).result.trigger, 'energy');
      await page.getByRole('button', { name: '다시하기' }).click();
      assert.equal((await snapshot(page)).seed, 20000);
      await page.evaluate(() => window.__gameDebug.restart(10004));
      await advance(page, 610000);
      await page.getByRole('button', { name: '새 게임' }).click();
      assert.notEqual((await snapshot(page)).seed, 10004);
      report('mobile flow ' + name, { canvas: cards.canvas, firstSkill: chosen });
      await page.close();
    }

    for (const [width, height] of [
      [320, 568],
      [568, 320],
    ]) {
      const page = await pageFor(width, height);
      const ids = [...skillIds, ...statIds];
      for (const rarity of rarityIds)
        for (let rank = 1; rank <= rules.maxRank; rank++) {
          for (let i = 0; i < ids.length; i += 3) {
            const cards = [0, 1, 2].map((n) => ids[(i + n) % ids.length]);
            await page.evaluate(
              ({ cards, rank, rarity }) => {
                window.__gameDebug.restart(1, false);
                const g = window.__gameDebug.getModel();
                g.setHidden(true);
                for (const id of cards) {
                  if (id in g.ranks) g.ranks[id] = rank - 1;
                  else g.boosts[id] = rank - 1;
                }
                g.choice = {
                  number: 2,
                  cards: cards.map((id) => ({ id, rarity })),
                  opened: 0,
                  deadline: 8,
                };
                window.__gameDebug.advance(0);
              },
              { cards, rank, rarity },
            );
            await page.waitForTimeout(100);
            await inspect(page);
            await inspectCards(page);
            assert.equal(await page.locator('.card .skill-preview').count(), 3);
          }
        }
      await screenshot(page, 'stat-cards-' + width + 'x' + height);
      report('all thirteen card types and five ranks fit ' + width + 'x' + height, {
        variants: ids.length * rules.maxRank * rarityIds.length,
      });
      await page.close();
    }

    await skillFlow();
    await interfaceFlow();
    await visualFlow();

    const page = await pageFor(375, 812);
    await page.getByRole('button', { name: 'START' }).click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = await snapshot(page);
    await advance(page, 10000);
    assert.deepEqual(await snapshot(page), hidden);
    await page.evaluate(() => {
      const g = window.__gameDebug.getModel();
      g.setManualPause(true);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(page, 10000);
    assert.equal((await snapshot(page)).time, hidden.time);
    assert.equal((await snapshot(page)).paused, true);
    await page.getByRole('button', { name: '계속하기' }).click();
    report('visibility and manual pause compose', { time: hidden.time });

    await page.evaluate(() => {
      window.__gameDebug.restart(17, false);
      const g = window.__gameDebug.getModel();
      window.__gameDebug.xp(1000);
      g.select('area');
      window.__gameDebug.advance(25000);
      g.mass = 150;
      g.radius = 40;
      g.choice.cards = ['accel', 'power', 'rate'].map((id) => ({ id, rarity: 'common' }));
    });
    await screenshot(page, 'gravity-danger');
    const before = await snapshot(page);
    await page.locator('.card').first().click();
    await advance(page, 2000);
    const recovered = await snapshot(page);
    assert.ok(recovered.radius > before.radius);
    assert.equal(recovered.mass, before.mass);
    await screenshot(page, 'gravity-recovery');
    report('acceleration restores the orbit without removing mass', {
      before: before.radius,
      after: recovered.radius,
      mass: recovered.mass,
    });

    await page.evaluate((energy) => {
      window.__gameDebug.restart(1, false);
      window.__gameDebug.xp(energy);
    }, rules.energyGoal);
    assert.equal(await page.locator('.charge b').textContent(), '100%');
    assert.equal(await page.locator('.charge').getAttribute('aria-label'), copy.ko.ready);
    await advance(page, 100);
    await screenshot(page, 'energy-collapse');
    await advance(page, rules.collisionSeconds * 1000 + 1000);
    await screenshot(page, 'black-hole');
    await advance(page, 10000);
    assert.equal((await snapshot(page)).result.outcome, 'success');
    await page.evaluate((energy) => {
      window.__gameDebug.restart(1, false);
      window.__gameDebug.xp(energy);
      const g = window.__gameDebug.getModel();
      g.mass = 1000;
      g.radius = g.core + 4;
      window.__gameDebug.advance(16000);
    }, rules.energyGoal - 1);
    await page.getByRole('heading', { name: copy.ko.failure, exact: true }).waitFor();
    assert.equal((await snapshot(page)).result.missingXp, 1);
    await screenshot(page, 'collapse-failure');
    report('readiness and both endings', { energyBoundary: rules.energyGoal });

    await page.evaluate(() => {
      window.__gameDebug.restart(20000);
      window.__gameDebug.advance(450000);
    });
    const frames = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const values = [];
          let previous;
          const sample = (now) => {
            if (previous !== undefined) values.push(now - previous);
            previous = now;
            if (values.length < 180) requestAnimationFrame(sample);
            else {
              values.sort((a, b) => a - b);
              const g = window.__gameDebug.getModel();
              resolve({
                medianMs: values[90],
                p95Ms: values[171],
                targets: g.targets.length,
                effects: g.effects.length,
                radius: g.radius,
                phase: g.phase,
              });
            }
          };
          requestAnimationFrame(sample);
        }),
    );
    assert.equal(frames.phase, 'running');
    await screenshot(page, 'late-play');
    report('late normal rendering on desktop Chrome', frames);
    await page.close();

    const settings = await pageFor(375, 812);
    await settings.getByRole('button', { name: '설정', exact: true }).click();
    assert.equal(await settings.locator(':focus').getAttribute('class'), 'text-button');
    await settings.keyboard.press('Shift+Tab');
    assert.equal(await settings.locator(':focus').textContent(), '日本語');
    await settings.keyboard.press('Tab');
    assert.equal(await settings.locator(':focus').textContent(), '닫기');
    await settings.getByRole('button', { name: '시각 효과 기본', exact: true }).click();
    await settings.getByRole('button', { name: '사운드 끔', exact: true }).click();
    await settings.getByRole('button', { name: '사운드 켬', exact: true }).waitFor();
    await settings.getByRole('button', { name: '닫기', exact: true }).click();
    await settings.reload();
    await settings.waitForSelector('canvas');
    assert.ok(await settings.locator('.app.is-reduced').count());
    await settings.getByRole('button', { name: '설정', exact: true }).click();
    await settings.getByRole('button', { name: '사운드 켬', exact: true }).waitFor();
    await settings.getByRole('button', { name: '닫기', exact: true }).click();
    await settings.getByRole('button', { name: 'START' }).click();
    await firstChoice(settings);
    const animations = await settings
      .locator('.skill-preview *')
      .evaluateAll((nodes) => nodes.every((n) => getComputedStyle(n).animationName === 'none'));
    assert.equal(animations, true);
    await screenshot(settings, 'reduced');
    report('sound and reduced effects persist', { reducedPreviewAnimations: false });
    await settings.close();

    const blocked = await browser.newPage({ viewport: { width: 375, height: 812 } });
    blocked.on('pageerror', (e) => errors.push(e.message));
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('disabled');
      };
      Storage.prototype.setItem = () => {
        throw new Error('disabled');
      };
    });
    await blocked.goto(base);
    await blocked.waitForSelector('canvas');
    await blocked.getByRole('button', { name: '설정', exact: true }).click();
    await blocked.getByRole('button', { name: '시각 효과 기본', exact: true }).click();
    await blocked.getByRole('dialog').getByText(copy.ko.storageFailed).waitFor();
    await blocked.getByRole('button', { name: '닫기', exact: true }).click();
    await blocked.getByRole('button', { name: 'START' }).click();
    await firstChoice(blocked);
    report('storage unavailable still plays', { phase: (await snapshot(blocked)).phase });
    await blocked.close();

    const privatePage = await browser.newPage({
      viewport: { width: 375, height: 812 },
      reducedMotion: 'reduce',
    });
    privatePage.on('pageerror', (error) => errors.push(error.message));
    await privatePage.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage access denied', 'SecurityError');
        },
      });
    });
    await privatePage.goto(base);
    await privatePage.waitForSelector('canvas');
    assert.equal(await privatePage.locator('.app.is-reduced').count(), 1);
    await privatePage.getByRole('button', { name: 'START' }).click();
    await firstChoice(privatePage);
    report('reduced motion survives denied storage access', {
      reduced: true,
      phase: (await snapshot(privatePage)).phase,
    });
    await privatePage.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    'artifacts/' +
      (process.argv.includes('--audio')
        ? 'audio-browser'
        : process.argv.includes('--skills')
          ? 'skills-browser'
          : process.argv.includes('--visuals')
            ? 'visuals-browser'
            : process.argv.includes('--interface')
              ? 'interface-browser'
              : process.argv.includes('--rarity')
                ? 'rarity-browser'
                : process.argv.includes('--production')
                  ? 'production'
                  : process.argv.includes('--realtime')
                    ? 'realtime-checks'
                    : 'browser') +
      '.json',
    JSON.stringify({ base, checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
