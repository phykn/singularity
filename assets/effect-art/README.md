# Electric effect artwork

Run `npm run build:art` to build the transparent runtime atlases in `src/art/assets/`. `electron-source.png` is the selected artwork generated with the built-in ImageGen tool. The exact generation and refinement prompts are in `prompts.json`. It is packed with nearest-neighbor sampling and fixed row pivots; the original alpha is preserved. `sprites.mjs` supplies the small hit marks, dissolves and connecting strands.

`effects.png` has four columns and seven rows of 32×32 cells: Hit, Heavy Impact, Ball Lightning, Charge Halo, Surge Corona, Particle Dissolve and Reconnection. Every row contains four frames. Generated electrical filaments wrap around the ball-lightning core and leave the Electron's center open. The Electron itself keeps its native 16×16 spherical artwork; Surge warms its palette instead of changing its silhouette.

Stored charge drives the halo's size, brightness and inward-moving charge dots. It stays visible between hits and releases with the actual discharge. Surge has one steady corona, a brief activation snap and a warm trail. Ball lightning has independent crackling frames while its body follows every simulation tick. Return strands and return-pierce strands end at the live Electron, with a compact reconnection snap.

`beams.png` has four columns and eight rows of 64×16 cells: Basic Arc, Chain Arc, Pierce Rail, Thunderstrike, Focused Current, Capacitor Discharge, Arc Bridge and Return Arc. Deliberate bends and short forks add electrical character while sustained beams stay thin. Focus and bridges carry a small moving current point.

All animation follows simulation time and freezes with combat. Effect quotas and pooled sprites bound the drawing work; hit timing, damage, skill colors, rarity borders and combat geometry are preserved.

`npm run check:effects` checks atlas transparency, live beam endpoints, pause behavior and sprite reuse. `npm run check:electric` captures real casts at multiple instants in portrait and landscape, including persistent charge, Surge, Return and a 240-particle crowd. These are renderer walkthroughs, not a human usability study.
