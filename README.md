# SINGULARITY

**One electron. A whole lot of lightning.**

A pixel-art survival game where a lone electron lights up the dark. The combat is automatic, the lightning keeps growing, and your orbit won't hold forever.

**[Play now — singularity.phykn-kr.workers.dev](https://singularity.phykn-kr.workers.dev/)**

<p align="center">
  <img src="assets/readme/gameplay-1.jpg" width="32%" alt="SINGULARITY title screen in English" />
  <img src="assets/readme/gameplay-2.jpg" width="32%" alt="Pierce lightning tearing through particles while three upgrade cards wait at a level-up" />
  <img src="assets/readme/gameplay-3.jpg" width="32%" alt="The gluon, the first giant particle, closing in with its health bar across the top" />
</p>

## About the game

Particles pour in from the first minute. The core swells. The space around you closes in. Each run snowballs from a crowded orbit into an electrical storm, with a singularity just beyond the chaos.

- **Let the sparks fly** — Sixteen skills, from a sky-splitting Thunderstrike to chain-popping fission, and every one of them evolves.
- **Find your rhythm** — Ride the electron's orbit, build a charge, and let it burst.
- **Survive the breach** — Five giant particles and a critical breach arrive on a fixed clock to test your build, and the singularity forms only when you destroy the Higgs particle.
- **Evolve or gamble** — Rare and epic cards are common, but an evolution is a rare windfall with no guarantee; up to three pacts trade a different kind of risk for a new way to pop.
- **Go beyond** — Reach the singularity, then take your build into endless rounds: each one brings a giant particle, and each one cleared makes the next round harder.
- **Small pixels, big impact** — Bright electrical effects against a dark cosmic backdrop.
- **Hear every pop** — Each skill pops in its own rhythm, one by one, all at once, as a cascade, a released charge or a sweep, and every particle kind clicks its own keycaps. Sound is on from the first run.
- **Open a tab. Enter orbit.** — A fresh run every time, with preferences and best results saved on your device.
- **Mobile and desktop** — Available in Korean, English, Chinese, and Japanese.

## Run locally

Requires Node.js 24 or later.

```sh
npm ci
npm run dev
```

Play at [localhost:8081](http://localhost:8081).

| Command                                    | Purpose                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `npm test`                                 | Test the game rules, the session, saved records and text                                          |
| `npm run check`                            | Tests, the rules schema, a 100-run bot measurement and the browser smoke checks, in two minutes   |
| `npm run sim -- balance [count] [seed]`    | Measure clear rate and pacing with the bot (`qte` taps every beat, `qte-off` never taps)          |
| `npm run sim -- skills [count] [seed]`     | Compare sixteen builds that each take one skill first                                             |
| `npm run sim -- beyond [count] [seed]`     | Continue cleared runs into endless mode and count the rounds they last                            |
| `npm run check:browser -- <scenario\|all>` | Drive the game in a browser: `smoke`, `choices`, `late-game`, `languages`, `performance`, `audio` |
| `npm run build`                            | Type check and create a production build                                                          |

Balance targets are bot references, not player clear rates: 15–20% for a bot that taps every beat and 10–15% for one that never taps, with paused choices taken by the game's automatic pick (an evolution first, a pact while the orbit has room, then power and attack speed, then the rarest card). The current rules measure 20% and 13% over 200 seeds (100 from 480000 and 100 from 700000), and winning runs take a median of about 15 and two-thirds minutes. To measure the same seeds:

```sh
npm run sim -- balance 100 480000 artifacts/qte.json qte
npm run sim -- balance 100 480000 artifacts/qte-off.json qte-off
```

## Credits & license

React · Phaser · TypeScript · Vite

Icon artwork: image-generated pixel art · Typography: [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) · Keycap sounds: [Keyboard Soundpack #1](https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes) by unicae_games (CC0 1.0)

Code is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use outside the license's permitted purposes requires separate permission from [the developer](https://github.com/phykn). Third-party libraries and fonts retain their original licenses.
