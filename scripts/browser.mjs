import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { rules, skillIds, statIds, rarityIds } from '../src/rules.ts';
import { copy } from '../src/i18n.ts';

const base = process.env.GAME_URL ?? 'http://localhost:8081';
const executable = process.env.BROWSER_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync('artifacts/v7', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
const errors = [], checks = [];
const report = (task, details) => { checks.push({ task, details }); console.log('PASS ' + task, JSON.stringify(details)); };
const pageFor = async (width, height, seed = 10004) => {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  if (base.includes('ngrok')) await page.setExtraHTTPHeaders({ 'ngrok-skip-browser-warning': 'true' });
  await page.goto(base + '/?seed=' + seed);
  await page.waitForSelector('canvas');
  if (!process.argv.includes('--production')) await page.waitForFunction(() => !!window.__gameDebug);
  return page;
};
const inspect = async (page) => {
  const value = await page.evaluate(() => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const buttons = [...document.querySelectorAll('button')].filter((b) => !b.closest('[inert]') && b.getBoundingClientRect().width > 0).map((b) => ({ text: b.textContent.trim(), ...rect(b) }));
    return { viewport: [innerWidth, innerHeight], scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], canvas: rect(document.querySelector('canvas')), buttons };
  });
  assert.deepEqual(value.scroll, value.viewport);
  for (const b of value.buttons) {
    assert.ok(b.w >= 43.9 && b.h >= 43.9, 'Small touch target: ' + b.text);
    assert.ok(b.x >= -.1 && b.y >= -.1 && b.x + b.w <= value.viewport[0] + .1 && b.y + b.h <= value.viewport[1] + .1, 'Offscreen: ' + b.text);
  }
  assert.ok(value.canvas.w > 0 && value.canvas.h > 0);
  return value;
};
const inspectCards = async (page) => {
  const clipped = await page.locator('.card-value, .card strong, .card-label').evaluateAll((nodes) => nodes.filter((node) => {
    const bounds = node.getBoundingClientRect(), card = node.closest('.card'), outer = card.getBoundingClientRect(), css = getComputedStyle(card);
    return node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1
      || bounds.left < outer.left + parseFloat(css.paddingLeft) - 1
      || bounds.right > outer.right - parseFloat(css.paddingRight) + 1;
  }).map((node) => node.textContent));
  assert.deepEqual(clipped, [], 'Card text must fit inside its padded content area');
};
const snapshot = (page) => page.evaluate(() => {
  const g = window.__gameDebug.getModel();
  return { phase: g.phase, seed: g.seed, time: g.time, seconds: g.seconds, xp: g.xp, mass: g.mass, radius: g.radius, level: g.level, ranks: g.ranks, boosts: g.boosts, rarities: g.rarities, score: g.score, rushSpawns: g.rushSpawns, choice: g.choice, selections: g.selections, paused: g.paused, result: g.result };
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
const screenshot = async (page, name) => { await page.waitForTimeout(120); await page.screenshot({ path: 'artifacts/v7/' + name + '.png' }); };

const rarityFlow = async () => {
  const page = await pageFor(375, 812);
  await page.evaluate(() => {
    window.__gameDebug.restart(21, false);
    window.__gameDebug.xp(18);
    const g = window.__gameDebug.getModel();
    g.choice.cards = [{ id: 'multi', rarity: 'legendary' }, { id: 'chain', rarity: 'epic' }, { id: 'area', rarity: 'rare' }];
    window.__gameDebug.advance(0);
  });
  await page.locator('.card[data-rarity="legendary"]').waitFor();
  await inspectCards(page); await screenshot(page, 'legendary-choice');
  await page.locator('.card[data-rarity="legendary"]').click();
  const selected = await snapshot(page);
  assert.equal(selected.rarities.multi, 'legendary');
  assert.equal(selected.ranks.multi, 1);
  assert.equal(await page.evaluate(() => window.__gameDebug.getModel().forms.multi.count), 5);
  await page.locator('.slot[data-rarity="legendary"]').waitFor();
  await screenshot(page, 'legendary-acquired');
  report('legendary card selection applies five branches and keeps its visible identity', { rank: selected.ranks.multi, rarity: selected.rarities.multi, branches: 5 });
  await page.close();
};

try {
  if (process.argv.includes('--rarity')) {
    await rarityFlow();
  } else if (process.argv.includes('--production')) {
    const page = await pageFor(375, 812);
    assert.equal(await page.evaluate(() => typeof window.__gameDebug), 'undefined');
    await page.getByRole('button', { name: 'START' }).click();
    await page.locator('.hud').waitFor(); await inspect(page); await screenshot(page, 'production');
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
    const page = await pageFor(375, 812, 10000);
    await page.getByRole('button', { name: 'START' }).click();
    const started = Date.now(), samples = [];
    let previous = 0;
    while (!(await snapshot(page)).result && Date.now() - started < 640000) {
      await page.waitForTimeout(30000);
      const s = await snapshot(page);
      assert.ok(s.seconds >= previous, 'The page restarted during the run'); previous = s.seconds;
      samples.push({ wallSeconds: (Date.now() - started) / 1000, time: s.time, seconds: s.seconds, xp: s.xp, mass: s.mass, radius: s.radius, phase: s.phase, choices: s.selections.length });
      console.log(JSON.stringify(samples.at(-1)));
    }
    const s = await snapshot(page);
    // Compare clocks inside Chrome: Node's trigonometric rounding can change a tied target choice.
    const expected = await page.evaluate(async () => {
      const { Game } = await import('/src/game.ts');
      const game = new Game(10000); game.start(); game.advance(610000);
      return game.result;
    });
    await screenshot(page, 'realtime-result');
    writeFileSync('artifacts/realtime.json', JSON.stringify({ version: rules.designVersion, viewport: [375, 812], seed: 10000, elapsedWallSeconds: (Date.now() - started) / 1000, samples, result: s.result, expected, errors }, null, 2));
    assert.equal(s.result?.outcome, 'success'); assert.equal(s.result.seconds, 600);
    assert.deepEqual(s.result, expected); assert.deepEqual(errors, []);
    report('normal clock: full autonomous game', { wallSeconds: (Date.now() - started) / 1000, result: s.result.outcome, xp: s.xp });
  } else {
    await rarityFlow();
    for (const [width, height] of [[360, 640], [375, 812], [320, 568], [430, 932], [812, 375], [568, 320]]) {
      const page = await pageFor(width, height), name = width + 'x' + height;
      await inspect(page); await screenshot(page, 'ready-' + name);
      assert.equal((await snapshot(page)).seed, 10004);
      await page.getByRole('button', { name: '도움말', exact: true }).click();
      await inspect(page); assert.equal(await page.locator('.skill-guide > div').count(), 11);
      await page.getByRole('button', { name: '닫기', exact: true }).click();
      await page.getByRole('button', { name: 'START' }).click();
      const playing = await inspect(page);
      assert.equal(await page.locator('.choices').count(), 0);
      if (height > width) assert.ok(playing.canvas.h / height >= .7);
      await firstChoice(page); await screenshot(page, 'cards-' + name);
      const cards = await inspect(page);
      assert.deepEqual(cards.canvas, playing.canvas);
      assert.equal(await page.locator('.card').count(), 3);
      await inspectCards(page);
      const chosen = (await snapshot(page)).choice.cards[1].id;
      await page.locator('.card').nth(1).click();
      assert.equal((await snapshot(page)).selections[0].id, chosen);
      await page.getByRole('button', { name: '일시정지', exact: true }).click();
      const frozen = await snapshot(page); await advance(page, 10000);
      assert.deepEqual(await snapshot(page), frozen);
      await inspect(page); await screenshot(page, 'pause-' + name);
      await page.getByRole('button', { name: '계속하기' }).click();
      await advance(page, 1000); assert.ok((await snapshot(page)).time > frozen.time);
      await page.getByRole('button', { name: '일시정지', exact: true }).click();
      await page.getByRole('button', { name: '그만하기', exact: true }).click();
      await page.getByRole('button', { name: '그만하기', exact: true }).click();
      const reset = await snapshot(page);
      assert.equal(reset.phase, 'ready'); assert.equal(reset.seed, 10004); assert.equal(reset.xp, 0); assert.equal(reset.mass, 0);
      await page.evaluate(() => window.__gameDebug.restart(10000));
      await advance(page, 610000); await page.getByRole('heading', { name: '블랙홀 생성', exact: true }).waitFor();
      await inspect(page); await screenshot(page, 'result-' + name);
      assert.equal((await snapshot(page)).result.seconds, 600);
      await page.getByRole('button', { name: '다시하기' }).click();
      assert.equal((await snapshot(page)).seed, 10000);
      await page.evaluate(() => window.__gameDebug.restart(10004));
      await advance(page, 610000);
      await page.getByRole('button', { name: '새 게임' }).click();
      assert.notEqual((await snapshot(page)).seed, 10004);
      report('mobile flow ' + name, { canvas: cards.canvas, firstSkill: chosen });
      await page.close();
    }


    for (const [width, height] of [[320, 568], [568, 320]]) {
      const page = await pageFor(width, height);
      const ids = [...skillIds, ...statIds];
      for (const rarity of rarityIds) for (let rank = 1; rank <= rules.maxRank; rank++) {
        for (let i = 0; i < ids.length; i += 3) {
          const cards = [0, 1, 2].map((n) => ids[(i + n) % ids.length]);
          await page.evaluate(({ cards, rank, rarity }) => {
            window.__gameDebug.restart(1, false);
            const g = window.__gameDebug.getModel();
            g.setHidden(true);
            for (const id of cards) { if (id in g.ranks) g.ranks[id] = rank - 1; else g.boosts[id] = rank - 1; }
            g.choice = { number: 2, cards: cards.map(id => ({ id, rarity })), opened: 0, deadline: 8 };
            window.__gameDebug.advance(0);
          }, { cards, rank, rarity });
          await page.waitForTimeout(100);
          await inspect(page); await inspectCards(page);
          assert.equal(await page.locator('.card svg').count(), 3);
        }
      }
      await screenshot(page, 'stat-cards-' + width + 'x' + height);
      report('all eleven card types and five ranks fit ' + width + 'x' + height, { variants: 11 * rules.maxRank * 4 });
      await page.close();
    }

    const page = await pageFor(375, 812);
    await page.getByRole('button', { name: 'START' }).click();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = await snapshot(page); await advance(page, 10000); assert.deepEqual(await snapshot(page), hidden);
    await page.evaluate(() => { const g = window.__gameDebug.getModel(); g.setManualPause(true); Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await advance(page, 10000); assert.equal((await snapshot(page)).time, hidden.time); assert.equal((await snapshot(page)).paused, true);
    await page.getByRole('button', { name: '계속하기' }).click();
    report('visibility and manual pause compose', { time: hidden.time });

    await page.evaluate(() => { window.__gameDebug.restart(17, false); const g = window.__gameDebug.getModel(); window.__gameDebug.xp(1000); g.select('area'); window.__gameDebug.advance(25000); g.mass = 150; g.radius = 40; g.choice.cards = ['accel', 'power', 'rate'].map(id => ({ id, rarity: 'common' })); });
    await screenshot(page, 'gravity-danger');
    const before = await snapshot(page);
    await page.locator('.card').first().click();
    await advance(page, 2000);
    const recovered = await snapshot(page);
    assert.ok(recovered.radius > before.radius); assert.equal(recovered.mass, before.mass);
    await screenshot(page, 'gravity-recovery');
    report('acceleration restores the orbit without removing mass', { before: before.radius, after: recovered.radius, mass: recovered.mass });

    await page.evaluate((energy) => { window.__gameDebug.restart(1, false); window.__gameDebug.xp(energy); }, rules.energyGoal);
    assert.equal(await page.locator('.charged-label').textContent(), '생성 준비 완료');
    await advance(page, 585000); await screenshot(page, 'final-convergence');
    await advance(page, 6000); await screenshot(page, 'black-hole');
    await advance(page, 10000);
    assert.equal((await snapshot(page)).result.outcome, 'success');
    await page.evaluate((energy) => { window.__gameDebug.restart(1, false); window.__gameDebug.xp(energy); const g = window.__gameDebug.getModel(); g.mass = 1000; g.radius = g.core + 4; window.__gameDebug.advance(16000); }, rules.energyGoal - 1);
    await page.getByRole('heading', { name: '소멸', exact: true }).waitFor();
    assert.equal((await snapshot(page)).result.missingXp, 1);
    await screenshot(page, 'collapse-failure');
    report('readiness and both endings', { energyBoundary: rules.energyGoal });

    await page.evaluate(() => { window.__gameDebug.restart(10004); window.__gameDebug.advance(450000); });
    const frames = await page.evaluate(() => new Promise((resolve) => {
      const values = []; let previous;
      const sample = (now) => { if (previous !== undefined) values.push(now - previous); previous = now; if (values.length < 180) requestAnimationFrame(sample); else { values.sort((a,b) => a-b); const g=window.__gameDebug.getModel(); resolve({ medianMs: values[90], p95Ms: values[171], targets: g.targets.length, effects: g.effects.length, radius: g.radius, phase: g.phase }); } };
      requestAnimationFrame(sample);
    }));
    assert.equal(frames.phase, 'running'); await screenshot(page, 'late-play');
    report('late normal rendering on desktop Chrome', frames);
    await page.close();

    const settings = await pageFor(375, 812);
    await settings.getByRole('button', { name: '설정', exact: true }).click();
    await settings.getByRole('button', { name: '시각 효과 기본', exact: true }).click();
    await settings.getByRole('button', { name: '사운드 끔', exact: true }).click();
    await settings.getByRole('button', { name: '사운드 켬', exact: true }).waitFor();
    await settings.getByRole('button', { name: '닫기', exact: true }).click();
    await settings.reload(); await settings.waitForSelector('canvas');
    assert.ok(await settings.locator('.app.is-reduced').count());
    await settings.getByRole('button', { name: '설정', exact: true }).click();
    await settings.getByRole('button', { name: '사운드 켬', exact: true }).waitFor();
    await settings.getByRole('button', { name: '닫기', exact: true }).click();
    await settings.getByRole('button', { name: 'START' }).click(); await firstChoice(settings);
    const animations = await settings.locator('.skill-preview *').evaluateAll((nodes) => nodes.every((n) => getComputedStyle(n).animationName === 'none'));
    assert.equal(animations, true); await screenshot(settings, 'reduced');
    report('sound and reduced effects persist', { reducedPreviewAnimations: false });
    await settings.close();

    const blocked = await browser.newPage({ viewport: { width: 375, height: 812 } });
    blocked.on('pageerror', (e) => errors.push(e.message));
    await blocked.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('disabled'); }; Storage.prototype.setItem = () => { throw new Error('disabled'); }; });
    await blocked.goto(base); await blocked.waitForSelector('canvas');
    await blocked.getByRole('button', { name: '설정', exact: true }).click();
    await blocked.getByRole('button', { name: '시각 효과 기본', exact: true }).click();
    await blocked.getByRole('dialog').getByText('진행 상황을 저장할 수 없어요.').waitFor();
    await blocked.getByRole('button', { name: '닫기', exact: true }).click();
    await blocked.getByRole('button', { name: 'START' }).click(); await firstChoice(blocked);
    report('storage unavailable still plays', { phase: (await snapshot(blocked)).phase });
    await blocked.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/' + (process.argv.includes('--rarity') ? 'rarity-browser' : process.argv.includes('--production') ? 'production' : process.argv.includes('--realtime') ? 'realtime-checks' : 'browser') + '.json', JSON.stringify({ version: rules.designVersion, checks, errors }, null, 2));
} finally { await browser.close(); }

