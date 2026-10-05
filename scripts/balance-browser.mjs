import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { base, launchBrowser } from './browser-support.mjs';
import { sourceHash } from './engine.ts';

const count = Number(process.argv[2] ?? 300),
  start = Number(process.argv[3] ?? 96000);
const output = process.argv[4] ?? 'artifacts/balance-browser.json';
const browser = await launchBrowser(),
  rows = [];
const hash = sourceHash();
try {
  const page = await browser.newPage();
  await page.goto(base);
  for (let offset = 0; offset < count; offset += 25) {
    rows.push(
      ...(await page.evaluate(
        async ({ start, count }) => {
          const { Game } = await import('/src/game/model.ts');
          const rows = [];
          for (let seed = start; seed < start + count; seed++) {
            const g = new Game(seed);
            g.start();
            g.advance(1800000);
            if (!g.result) throw new Error('No result: ' + seed);
            rows.push(g.result);
          }
          return rows;
        },
        { start: start + offset, count: Math.min(25, count - offset) },
      )),
    );
    console.log(
      JSON.stringify({
        games: rows.length,
        wins: rows.filter((r) => r.outcome === 'success').length,
      }),
    );
  }
  for (const r of rows) {
    for (const c of Object.values(r.counts))
      assert.equal(c.generated, c.killed + c.absorbed + c.remaining);
    assert.equal(r.trigger, r.outcome === 'success' ? 'energy' : 'gravity');
  }
  const wins = rows.filter((r) => r.outcome === 'success').length;
  const summary = { games: rows.length, wins, clearRate: wins / rows.length };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        sourceHash: hash,
        runtime: 'Chromium',
        scope: 'Automatic highest-rarity selection, first card on ties.',
        validationSeeds: [start, start + count - 1],
        summary,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
}
