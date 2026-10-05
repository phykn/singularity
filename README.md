# SINGULARITY

A mobile browser game about an orbiting electron, growing lightning, and a final black hole. Movement and combat are automatic, with no time limit.

- Choose one of three upgrades, or let the game choose after eight seconds.
- Combine any four of sixteen lightning skills, from branching bolts to charged strikes and returning currents. Grow through five ranks and four rarities.
- Keep leveling and improving stats. Reach the XP goal to form a black hole.
- Stop incoming particles from building central mass and collapsing your orbit.
- Play in Korean, English, Chinese, or Japanese. Progress saves locally.

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
- `game/combat.ts` owns attacks and their ongoing effects. `game/skills.ts` computes rank, rarity and reach values from `design/rules.json`; combat, `ui/skillText.ts` and `ui/SkillPreview.tsx` share those values. `game/growth.ts` chooses eligible upgrades and cards.
- `game/replay.ts` owns checkpoint creation and deterministic replay. `app/storage.ts` validates and stores checkpoints under `singularity.run`: seed, elapsed ticks, phase, manual pause and manual selections. Automatic choices are regenerated from the seed. Keep this format compatible when changing replay or storage.
- `render/GameCanvas.tsx` owns Phaser's lifecycle; `render/scene.ts` draws the current model. `ui/` contains React controls, translations and styles.

Run `npm test`, `npm run build`, `npm run format:check` and `npm run check:design` after changes. `npm run benchmark` compares 30 seeded games at 30 and 60 fps.

With `npm run dev` running, use `npm run check:browser` for gameplay and layout, `npm run check:startup` for loading and graphics recovery, `npm run check:resume` for reload, crash recovery and storage failures, and `npm run check:languages` for all four languages. These Playwright checks use installed Chrome or Edge on Windows, or Playwright Chromium elsewhere (`npx playwright install chromium` if needed). Set `BROWSER_PATH` to use another Chromium executable and `GAME_URL` to change the default `http://localhost:8081`. Reports and screenshots go to ignored `artifacts/` folders. `npm run check:performance` additionally measures rendering and combat under CPU throttling.

## Credits

Built with React, Phaser, TypeScript, and Vite. Icons by [Pixelarticons](https://github.com/halfmage/pixelarticons); typography from [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font). Original font license notices are bundled.

## License

Project code is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use outside the license's permitted purposes requires separate permission from [phykn](https://github.com/phykn). Third-party libraries and fonts retain their original licenses.
