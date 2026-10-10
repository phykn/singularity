# Working on SINGULARITY

Use Node.js 24 or later. Start from the [README](README.md) for local setup.

## Where behavior lives

| Area                                          | Owner and entrypoint                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Game rules                                    | `design/rules.json`, loaded by `src/game/rules.ts`; this is the current configuration, with no older rules or save migrations                                                        |
| Start, pause, restart, visibility, speed, QTE | `src/app/useGame.ts` connects React to `GameSession.ts`; the session advances `Game.ts` and `OrbitRhythm.ts`                                                                         |
| Combat and skill combinations                 | `src/game/combat.ts` owns attacks, delayed hits, timers and shared reaction budgets; `skills.ts` derives values from ranks and rarity                                                |
| Choices and growth                            | `src/game/growth.ts` generates offers; `Game.ts` owns availability, selection and the first skill rarity; `src/ui/Choices.tsx` renders cards and `useChoiceInput.ts` guards gestures |
| Saved preferences and best results            | `src/app/storage.ts` owns keys, validation and record ranking; `ResultRecords.ts` merges best results and retries at most one record per mode                                        |
| Drawing                                       | `src/render/ElectronScene.ts` draws particles, electron and phases; `EffectRenderer.ts` owns effect graphics and its own sprite pool; `DamageLabels.ts` places integer damage labels |
| Transition timelines                          | `src/presentation/ending.ts` and `beyond.ts` calculate the shared visual, HUD and sound stages without owning any of those consumers                                                 |
| Sound                                         | `src/app/GameAudio.ts` owns the audio graph; session audio activation reports failure back to the UI                                                                                 |
| Art and translations                          | `src/art/skills.ts` maps the current atlas; `scripts/art.mjs` builds it; `src/ui/i18n.ts` and `skillText.ts` own player text                                                         |

The browser starts a fresh seeded run on reload or restart. It stores settings, language and best results, not an active run. `src/game/checkpoint.ts` replays model inputs for diagnostics and tests; it does not restore session QTE windows, playback speed or choice-pause preferences.

Follow a gameplay value through its producer before changing its presentation. For example, QTE taps go through the session and `OrbitRhythm`, accepted beats call `Game.resonate`, combat publishes damage and effects, and the renderer consumes them. `Combat.status()` produces skill cooldown readiness and activation; `src/ui/Loadout.tsx` consumes it without running an independent attack timer.

## Time units

- Session methods and `OrbitRhythm` receive wall-clock **milliseconds**. QTE windows, hit stop and active choice countdowns use this clock.
- `Game.tick` counts running combat ticks; `Game.time` is that count in **seconds**.
- `Game.elapsedTicks` includes phase transitions; `Game.seconds` converts it to **seconds**. Effect lifetimes and checkpoint inputs use this timeline.
- `Game.phaseTicks` measures the current transition. Default choices pause gameplay; active choices have a five-second countdown independent of playback speed.

## Validate a change

```sh
npm test
npm run check:design
npm run build
```

Browser checks need a running development server. They use Playwright with installed Chrome or Edge on Windows, or its Chromium elsewhere. If no browser is available, run `npx playwright install chromium`. Set `GAME_URL` to test another local port and `BROWSER_PATH` to choose an executable. For PowerShell:

```powershell
$env:GAME_URL = 'http://localhost:8081/'
npm run check:browser
npm run check:choice-input
npm run check:effects
```

Use the matching `check:*` command in `package.json` for a changed surface. Development checks use local debug fixtures; only `npm run check:browser -- --production` supports the public production app. Screenshots and reports go to ignored `artifacts/`. Keep the current README images and `scripts/screenshots.mjs`.

## Balance diagnostics

These commands measure different questions. All use current rules by default; an optional rules JSON replaces the whole configuration.

```sh
# Real session, same seeds and highest-rarity choices; perfect QTE versus no taps.
npm run check:balance -- 600 480000 artifacts/qte.json qte
npm run check:balance -- 600 480000 artifacts/no-qte.json qte-off

# Small smoke runs; increase the seed count for balance decisions.
npm run check:skill-balance -- 2 300000 artifacts/builds.json auto,satellite,gather
npm run check:skill-trial -- 1 artifacts/encounters.json design/rules.json common
```

`check:balance` arguments: count, first seed, report path, policy (`qte`, `qte-off`, `qte-guided`, `auto`, or `guided`), optional rules JSON. The QTE reference targets are 15–20% with perfect hits and 10–15% without taps. Both select paused choices immediately, highest rarity first and first card on ties. They measure bots, not human clear rates.

`check:skill-balance` arguments: count per policy, first seed, report path, comma-separated `auto`/skill IDs, optional rules JSON. It compares matched runs, preferring a named skill only among the highest-rarity offers. Results reflect the resulting build, not isolated skill strength.

`check:skill-trial` arguments: seed count, report path, optional rules JSON, comma-separated rarities. It compares fixed 30-second enemy streams at early, middle and late stages, with equal ranks and fixed orbit/stats. Solo and fourth-slot encounters measure effective damage, kills and net mass against matched baselines. They exclude QTE, growth, rush spawns and collision endings. Spawn intervals must round to a positive tick count.

Reports include the rules, seed range, policy/scope and source hashes. `sourceHash` covers game modules, the session, rhythm and current rules; `simulationHash` covers each diagnostic driver and its rhythm bot when used. Compare reports only when these inputs match, or explicitly account for intended differences.

## Publish

Before each push, run `npm version patch --no-git-tag-version` and commit both `package.json` and `package-lock.json`. The title reads this version directly. Keep only current behavior and one checkpoint format; do not add version-specific paths.
