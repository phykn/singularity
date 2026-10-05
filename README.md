# SINGULARITY

**From a tiny electron to a powerful singularity.**

A pixel-art survival game about protecting an orbiting electron and growing its lightning. Movement and attacks are automatic. You choose the skills and combinations that keep you alive.

<p align="center">
  <img src="docs/images/gameplay-1.jpg" width="32%" alt="Incoming particles surrounding the electron's orbit" />
  <img src="docs/images/gameplay-2.jpg" width="32%" alt="Three upgrade choices during combat" />
  <img src="docs/images/gameplay-3.jpg" width="32%" alt="A lightning build fighting incoming particles" />
</p>

## About the game

Defeat enemies to earn XP, then choose one of three upgrades each time you level up. Missed particles accumulate in the core and shrink your orbit. Grow strong enough to form a singularity before the orbit collapses.

- **Build your own lightning** — Combine four of sixteen skills and upgrade them through multiple ranks.
- **Make every choice count** — A skill's rarity locks when you first acquire it. Take it now or wait for a better roll.
- **Jump straight in** — Play in your browser, with progress saved automatically on your device.
- **Mobile and desktop** — Supports Korean, English, Chinese, and Japanese.

## Run locally

Requires Node.js 24 or later.

```sh
npm ci
npm run dev
```

Play at [localhost:8081](http://localhost:8081).

| Command         | Purpose                   |
| --------------- | ------------------------- |
| `npm test`      | Test the game rules       |
| `npm run build` | Create a production build |

## Credits & license

React · Phaser · TypeScript · Vite

Icons: [Pixelarticons](https://github.com/halfmage/pixelarticons) · Typography: [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)

Code is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use outside the license's permitted purposes requires separate permission from [the developer](https://github.com/phykn). Third-party libraries and fonts retain their original licenses.
