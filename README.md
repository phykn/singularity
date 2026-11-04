# SINGULARITY

**One electron. A whole lot of lightning.**

A pixel-art survival game where a lone electron lights up the dark. The combat is automatic, the lightning keeps growing, and your orbit won't hold forever.

**[Play now — singularity.phykn-kr.workers.dev](https://singularity.phykn-kr.workers.dev/)**

<p align="center">
  <img src="assets/readme/gameplay-1.jpg" width="32%" alt="SINGULARITY title screen in English" />
  <img src="assets/readme/gameplay-2.jpg" width="32%" alt="A late-game lightning build facing a dense particle swarm with upgrade choices open" />
  <img src="assets/readme/gameplay-3.jpg" width="32%" alt="Singularity victory screen showing 20,000 XP and the completed skill build" />
</p>

## About the game

Particles pour in. The core swells. The space around you closes in. Each run turns a quiet orbit into an electrical storm, with a singularity just beyond the chaos.

- **Let the sparks fly** — Sixteen skills, from a sky-splitting Thunderstrike to chain-popping fission, and every one of them evolves.
- **Find your rhythm** — Ride the electron's orbit, build a charge, and let it burst.
- **Survive the breach** — Five giant particles and a critical breach test your build, and the singularity forms only when you destroy the Higgs particle.
- **Evolve or gamble** — Luck brings rarer cards and evolutions; up to three pacts trade a different kind of risk for a new way to pop.
- **Go beyond** — Reach the singularity, then take your build into an ever-growing storm.
- **Small pixels, big impact** — Bright electrical effects against a dark cosmic backdrop.
- **Hear every pop** — Each skill pops in its own rhythm, one by one, all at once, as a cascade, a released charge or a sweep, and every particle kind clicks its own keycaps.
- **Open a tab. Enter orbit.** — A fresh run every time, with preferences and best results saved on your device.
- **Mobile and desktop** — Available in Korean, English, Chinese, and Japanese.

## Run locally

Requires Node.js 24 or later.

```sh
npm ci
npm run dev
```

Play at [localhost:8081](http://localhost:8081).

| Command                       | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `npm test`                    | Test the game rules                                         |
| `npm run build`               | Create a production build                                   |
| `npm run check:balance`       | Measure clear rate with successful QTE play                 |
| `npm run check:pacing`        | Measure whether a run stays undecided after the build forms |
| `npm run check:skill-balance` | Compare sixteen skill-priority builds on matched seeds      |
| `npm run check:skill-trial`   | Compare equal-rank encounters and fourth-slot contributions |

Balance references use the real session with immediate paused choices and the game's automatic selection. Targets are 15–20% with successful QTE inputs and 10–15% without QTE. These are bot references, not measured player clear rates. The current rules measure 18.3% with QTE and 13.0% without on 600 seeds from 480000, and 19.2% and 13.3% on a second cohort from 700000. Winning runs take a median of about 17 and three-quarter minutes. To compare matched seeds:

```sh
npm run check:balance -- 600 480000 artifacts/qte.json qte
npm run check:balance -- 600 480000 artifacts/no-qte.json qte-off
```

## Credits & license

React · Phaser · TypeScript · Vite

Icon artwork: image-generated pixel art · Typography: [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) · Keycap sounds: [Keyboard Soundpack #1](https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes) by unicae_games (CC0 1.0)

Code is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use outside the license's permitted purposes requires separate permission from [the developer](https://github.com/phykn). Third-party libraries and fonts retain their original licenses.
