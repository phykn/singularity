# Electric effect artwork

`sprites.mjs` is the source for the current pixel effects. Run `npm run build:art` to paint the transparent runtime atlases in `src/art/assets/`. It uses three solid tones and integer pixel coordinates; the game tints them by skill.

`effects.png` has four columns and six rows of 32×32 cells: Hit, Heavy Impact, Ball Lightning, Charge Halo, Surge Aura and Particle Dissolve. Each row contains four frames. The visible marks stay small: short hit sparks, a 10-pixel orb, open charge arcs, a restrained Surge outline and four dissolving pixels. Shared cell centers keep animation steady; the charge and Surge centers remain transparent around the Electron.

`beams.png` has four columns and eight rows of 64×16 cells: Basic Arc, Chain Arc, Pierce Rail, Thunderstrike, Focused Current, Capacitor Discharge, Arc Bridge and Return Arc. Each row contains four frames. Single strands and a few deliberate bends connect actual attack endpoints. Strong discharges use a second pixel of thickness; sustained beams remain narrow.

The renderer adds only the marks needed to explain an action. Repeat uses its actual repeated casts, Chain shows its connections, and only one charging halo is visible. Damage numbers, hit timing, skill colors and combat geometry remain intact. Animation follows simulation time and pauses with combat. Particle bodies use the separate 16×16 sphere cells in `src/art/particles.ts`.
