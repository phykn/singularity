# SINGULARITY

A mobile browser game about an orbiting electron, growing lightning, and a final black hole. Movement and combat are automatic, with no time limit.

- Choose one of three upgrades, or let the game choose after eight seconds.
- Combine any four of sixteen lightning skills, from branching bolts to charged strikes and returning currents. Each skill's rarity locks when you first pick it; later upgrades raise its rank, up to five. Pass an unlearned skill to wait for another rarity roll. Slot borders show the fixed rarity without flashing.
- Improve Attack Power, Attack Speed, Range and Move Speed without a rank limit. Move Speed increases orbital travel by 10% of base speed per common-rarity rank. Reach the XP goal to form a black hole.
- Choices expire after eight seconds and select the highest-rarity card, taking the first card on ties. The arrow marks that exact card. Cooldown fills remain ready until a skill actually casts; linked skills reset on their own visible effects. Surge turns the electron gold with an electric aura and a longer trail.
- Orb bodies are drawn from live combat positions every rendered frame, independently of transient lightning quotas. Their discharge interval and damage stay governed by the combat rules. Damage numbers round to integers for readability.
- Enemy batches use seeded variation in size, timing, formation, speed and species. Wave warning directions remain consistent with their wave. `design/rules.json` contains the variation bounds and current balance values.
- Stop incoming particles from building central mass and collapsing your orbit.
- Play in Korean, English, Chinese, or Japanese. Progress saves locally.
- Cards show skill rank growth with dots and stat rank changes with numbers. Open the guide from the pause menu to check skill triggers without losing the run or consuming the choice countdown. The orbit becomes a steady, brighter amber ring when dangerously close to the core and returns to its normal appearance after recovery.

## Run

Requires Node.js 24 or later.

```sh
npm ci
npm run dev
```

Open `localhost:8081`. Use `npm run build` for a production build, `npm test` for engine tests, and `npm run format:check` to check code formatting.

## Code map

- `src/main.tsx` mounts `app/App.tsx`. `app/useGame.ts` connects React, preferences, browser events and storage to `app/session.ts`, which owns the live game, frame clock, pause transitions, audio event cursor and save timing.
- `game/model.ts` advances the simulation at `design/rules.json`'s `tickRate`. `tick` counts active play; `elapsedTicks` also includes ending animations. Browser wall time is in milliseconds; rule durations and event times are in seconds. Pauses and renderer loading do not consume game time.
- `game/combat.ts` owns attacks and their ongoing effects. `game/skills.ts` computes rank, rarity and reach values from `design/rules.json`; combat and `ui/skillText.ts` share those values. Cards and skill slots share the 16-pixel grids in `ui/glyphs.ts`, rendered by `ui/icons.tsx`. `game/growth.ts` chooses eligible upgrades and cards.
- `game/replay.ts` owns checkpoint creation and deterministic replay. `app/storage.ts` validates and stores checkpoints under `singularity.run`: seed, elapsed ticks, phase, manual pause and manual selections. Automatic choices are regenerated from the seed. Checkpoints use only the current rules and format; incompatible saved runs are not migrated.
- `render/GameCanvas.tsx` owns Phaser's lifecycle; `render/scene.ts` draws the current model, including ongoing orb positions from combat and transient lightning effects. `ui/` contains React controls, translations and styles.

Run `npm test`, `npm run build`, `npm run format:check` and `npm run check:design` after changes. `npm run benchmark` compares 30 seeded games at 30 and 60 fps.

With `npm run dev` running, use `npm run check:browser` for gameplay and layout, `npm run check:startup` for loading and graphics recovery, `npm run check:resume` for reload, crash recovery and storage failures, and `npm run check:languages` for all four languages. These Playwright checks use installed Chrome or Edge on Windows, or Playwright Chromium elsewhere (`npx playwright install chromium` if needed). Set `BROWSER_PATH` to use another Chromium executable and `GAME_URL` to change the default `http://localhost:8081`. Reports and screenshots go to ignored `artifacts/` folders. `npm run check:performance` additionally measures rendering and combat under CPU throttling.

For balance, run `node scripts/balance.ts 900 96000 artifacts/balance.json` to measure the highest-rarity automatic policy against the approximate 10% target. Reports include seed ranges, current rules, source hashes and 95% Wilson intervals. Use `node scripts/balance-browser.mjs 300 96000` to check the browser runtime, and `node scripts/balance.ts 300 96000 artifacts/guided.json guided` for a visible-state choice heuristic that selects after one second. The guided result is a bot comparison; human performance requires playtests. Reserve a separate seed range for validation after tuning.

For polish, `node scripts/browser.mjs --polish` checks the automatic marker, ready/actual-cast cooldowns, surge activation/expiration, the XP row and sound-only settings. `node scripts/browser.mjs --qa` checks graphical rank previews and access to the guide during a pending choice without consuming its timer. Keep damage numbers as hit feedback; avoid adding explanatory text to active play when graphics can communicate it. Then watch new players play without explaining the UI: note what they mistake for an attack, when they miss a skill activation, and whether they understand each death. Record the seed, reproduction steps, expected/actual behavior and a short clip. Fix gameplay blockers and misleading feedback before decorative changes, then rerun the affected regression checks on small phones and busy late-game scenes.

`node scripts/browser.mjs --orb` checks the rendered orb position on every simulation tick and verifies that visible damage labels remain integers. The browser checks share `scripts/browser-support.mjs` for renderer observation; the hook is injected only into development test responses.

## Credits

Built with React, Phaser, TypeScript, and Vite. Icons by [Pixelarticons](https://github.com/halfmage/pixelarticons); typography from [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font). Original font license notices are bundled.

## License

Project code is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use outside the license's permitted purposes requires separate permission from [phykn](https://github.com/phykn). Third-party libraries and fonts retain their original licenses.
