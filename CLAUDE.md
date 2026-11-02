# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

[CONTRIBUTING.md](CONTRIBUTING.md) maps each behavior to the file that owns it, defines the time units, and documents the audio and balance diagnostics. Read the relevant section before changing those areas.

## Commands

Requires Node.js 24 or later. Run `npm ci` first: `npm test` fails on `tests/browser-support.test.ts` without Playwright installed.

```sh
npm run dev           # http://localhost:8081, strict port
npm test              # all rule, session and diagnostic tests
npm run check:design  # assertions on design/rules.json
npm run build         # the only type check, then a production build
npm run format:check
```

Run one test file or one test by name:

```sh
node --test tests/rhythm.test.ts
node --test --test-name-pattern='browser hit history' tests/session.test.ts
```

`check:*` commands that run `scripts/*.mjs` drive a real browser and need the dev server running. Pick the one that matches the changed surface. Those that run `scripts/*.ts` (`check:balance`, `check:skill-balance`, `check:skill-trial`, `check:beyond`) run headless in Node.

## Architecture

SINGULARITY is a seeded, deterministic simulation with React and Phaser as separate views of it.

- **`src/game`** is the model: it imports nothing from the other `src` folders and uses no DOM, React, or Phaser. `Game` advances in fixed ticks and runs under plain Node, which is why tests and balance scripts can run whole games. `Combat` is owned by `Game` and calls back into it. Values come from `design/rules.json`; `Game` also accepts a replacement rule set through its `rules` option, which the balance scripts use.
- **`GameSession`** (`src/app`) is the bridge from wall-clock time to ticks. It owns what is not game state: playback speed, choice-pause preference, hit stop, the QTE `OrbitRhythm`, and the audio cursor. It is framework-free and tested directly. `useGame` only forwards `performance.now()` to it from a single `requestAnimationFrame` loop.
- **React** does not re-render per frame. `GameSession` calls the `redraw` callback on state changes and at most every 80 ms during play.
- **Phaser** does not receive props. `ElectronScene.update` pulls the current state each frame through `getGame()` and `getRhythm()`, so a restart swaps the model without rebuilding the scene.

### Data flow out of the model

The model publishes and the views read.

- `game.events` is an append-only log, with `eventOffset` counting trimmed entries. `GameAudio` reads it from the session's cursor, so combat sounds come from logged events; the session plays only the QTE burst and title preview directly. The browser passes `recordEvents: false`, which trims old history; tests and diagnostics keep it all by default.
- `game.effects` and `game.damageNumbers` carry their birth time and are read by the renderer.
- `src/presentation` calculates transition stages as pure functions shared by visuals, HUD and sound.

### Run phases

`ready -> running -> collapse -> ending -> result`. Both victory and failure pass through `collapse`. After a victory, `continueBeyond` moves `result -> crossing -> running` in endless mode and keeps the win in `clearResult`.

### Determinism

- `Game` uses separate `Random` streams for spawns, cards, and rarity. Adding a draw to one stream changes later values in that stream, so matched-seed balance results shift.
- `checkpoint.ts` rebuilds a run by replaying seed, selections, and resonance inputs under current rules. It is for diagnostics and tests; the browser never saves an active run.
- Balance reports embed `sourceHash` (`src/game/*`, `GameSession`, `OrbitRhythm`, the rules), so any edit to those files makes old and new reports differ.

## Conventions

- Node runs the TypeScript directly through type stripping, with no build step. Code reached by tests or scripts must use erasable syntax only (no `enum`, no constructor parameter properties) and explicit `.ts` import extensions.
- `tsconfig.json` includes only `src`, so `tests/` and `scripts/` are not type checked.
- Browser checks use `window.__gameDebug` (`prepare`, `restart`, `advance`, `xp`, `clear`, `getModel`, `getRhythm`), which exists only in development builds. Use it for fixtures rather than adding new debug hooks.
- In tests, `new Game(seed, { combat: false })` disables spawning so a test can place its own targets. `tests/helpers.ts` provides `fixture`, `target`, `choose`, and `stationarySkill`.
- `check:design` also asserts array lengths and invariants across `design/rules.json`, so changing a stage or skill table can require matching changes elsewhere in the file.
- Player text lives in `src/ui/i18n.ts` and `skillText.ts`, in Korean, English, Chinese, and Japanese. `check:languages` covers layout across them.
