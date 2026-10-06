# Electric effect artwork

Created with the built-in image generation tool. The selected neutral pixel artwork is `pixel-art.png`; `npm run build:art` packs it into `src/art/assets/effects.png`. Illustrated trials are not shipped.

The runtime sheet has four columns and six rows of 32×32 cells: Hit, Heavy Impact, Ball Lightning, Charge Halo, Surge Aura, Particle Dissolve. Every row contains four animation frames. Packing uses nearest-neighbor sampling of whole cells, preserving alpha and shared centers. Do not trim individual frames: it changes their registration and causes wobble.

Cells include transparent margins; their visible bodies are smaller than 32 pixels. Particles use hand-authored 16×16 grids at native screen scale. Short impacts follow effect lifetime; sustained effects loop on simulation time and freeze with combat. Tint follows each skill's existing color. The same sprite pool is reused each frame, and the existing effect quotas still bound busy scenes. Damage numbers and combat geometry are unchanged.

## Emitted lightning

`beams.png` was generated with the built-in image generation tool and packed by `npm run build:art` into `src/art/assets/beams.png`. The runtime atlas has four columns and eight rows of 64×16 cells, four frames per style: Basic Arc, Chain Arc, Pierce Rail, Thunderstrike, Focused Current, Capacitor Discharge, Arc Bridge and Return Arc.

The renderer rotates and stretches each beam between its actual endpoints, keeping screen thickness restrained. Electron-anchored effects follow the live electron; focused beams also track their target. Simulation time drives animation, including pause behavior. Skill tint, direction markers, impact sprites and integer damage numbers remain. Only the generated beam atlas supplies connecting lightning; it does not alter attack timing, hit geometry or balance.

### Beam source prompt

Use case: stylized-concept
Asset type: transparent PIXEL-ART lightning beam animation atlas for a very small retro electric survival game.

ONE atlas, EXACTLY 4 COLUMNS and 8 ROWS. Every cell is a WIDE rectangle in a 4:1 width/height ratio; whole atlas is 2:1 landscape. Each cell is a true 64x16 logical pixel sprite enlarged with nearest neighbor. The FOUR CELLS IN EACH ROW are four subtle animation frames of ONE lightning style. Exactly 32 sprites. No text, frames, icons, people, circles, impact stars, fire, shadow, smoke, gradient or glow. Transparent alpha background, including all spaces between the sprite pixels.

Each sprite is a LONG HORIZONTAL ELECTRIC BEAM going LEFT TO RIGHT, occupying almost the entire cell width. Start and end are aligned on the SAME central horizontal axis, x=1 to x=62 at y=8. Only tiny 1-pixel or 2-pixel square stepped strokes. Maximum occupied height 10 logical pixels for the largest beam, 4 to 6 pixels for the light beams. Opaque ivory/light grey/mid grey palette only, tintable. No diffuse glow or blur: sharp purposeful square pixels, like old 16x16 Aseprite game art.

Row order top to bottom:
1 BASIC ARC: thin irregular stepped zigzag, one sharp kink, few tiny side branches.
2 CHAIN ARC: thin angular stepped lightning, two brighter tiny junctions on its length, fragmented small side branch.
3 PIERCE RAIL: fast straight thin center line with two broken short parallel rails, no large tip or target.
4 THUNDERSTRIKE: heavier single jagged lightning, bright 2-pixel core and two very short branching kinks.
5 FOCUSED CURRENT: two fine tightly braided stepped filaments around the center axis, not a thick laser.
6 CAPACITOR DISCHARGE: strong compact double zigzag with a bright center and restrained small side branches, no explosion.
7 ARC BRIDGE: thin continuous irregular live wire, small uneven rhythmic kinks, calm subtle shifting four-frame loop.
8 RETURN ARC: slender backflow electricity with a bright small pulse traveling RIGHT TO LEFT across the four frames.

Each frame must remain centered and have identical endpoints. Simple, coarse, sharply stepped pixels that complement tiny rough particle sprites. No smooth curves, no illustration lighting. Actual transparent background.

## Source prompt

Use case: stylized-concept
Asset type: transparent animated VFX sprite sheet for a minimalist pixel-art electricity survival game.
Create ONE production-ready sprite atlas: EXACTLY FOUR COLUMNS and SIX ROWS, equal square cells, twenty-four frames, transparent background. Every row is ONE four-frame animation progressing LEFT TO RIGHT. Keep the same center and scale in every frame of a row. No labels, borders, text, backgrounds, checkerboard, UI, enemies or characters.

Art direction: authentic tiny 16x16-era game pixels, a deliberate 32x32 logical pixel grid per cell displayed at an integer zoom. Sharp square pixels and stepped contours; only opaque white, ivory-gray and light-gray, with actual transparent gaps. This is a neutral tintable VFX mask. No black outlines, smooth glow, gradients, blur, antialiasing, wispy smoke, fire, magical runes, or random particle noise. Very spare design, just a few intentional pixel clusters, lots of transparent space. Fits next to small simple round particle sprites on a nearly black space background. NEVER a skill icon or badge: these are transient electrical animations.

Rows top to bottom:

1. SMALL HIT SPARK: four compact electric impact frames, bright 3-pixel ignition -> sharp asymmetric four-point spark -> separated short pixel prongs -> 3 disappearing motes. Maximum occupied width 14 logical pixels, exactly centered.
2. HEAVY DISCHARGE IMPACT: ignition -> strong angular electric starburst with six short prongs -> broken expanding arcs -> sparse fading ends. Maximum width 24 logical pixels. No solid disk; open center, controlled silhouette.
3. BALL LIGHTNING: four loopable frames of a tiny compact sphere, 8 logical pixels across, bright center and simple stepped shell, one small electric notch moves around the rim. Sphere center and overall diameter identical in all four frames.
4. CHARGE HALO: four loopable stages of two or three short angular electric arcs around an EMPTY center. Outer diameter 23 logical pixels, central 16-pixel diameter hole COMPLETELY TRANSPARENT so a small particle remains visible. Arc clusters shift subtly clockwise, calm and readable.
5. SURGE AURA: four loopable frames of a stronger energized halo, three clean zigzag arcs orbit an EMPTY transparent center. Outer diameter 30 logical pixels, central 18-pixel hole COMPLETELY TRANSPARENT. Open disconnected arcs, brighter than row 4, but no filled disk or dense debris.
6. PARTICLE DISSOLVE: four brief frames, tiny diamond flash -> four short chips separating -> four sparse chips farther apart -> two tiny last chips, max width 18 logical pixels. Gentle disappearance, not an explosion.

Critical: 4 columns x 6 rows; precisely equal cells; every artwork stays well inside its own cell; aligned centers; no overlap or extra decorative marks. True transparent background.

## Pixel refinement prompt

Use case: style-transfer
Edit target: the attached four-column six-row electric VFX sprite sheet.
KEEP exact 4x6 layout, every cell center, every frame silhouette, row order and frame order.
REMOVE ALL SOFT GLOW, ALL LIGHT HAZE, ALL GRAY BACKGROUND and all soft shadow. Every space not occupied by a sharp sprite pixel must have alpha=0. The empty centers of the two halo rows must be FULLY transparent, as must every cell margin. No rendered checkerboard.
Redraw as TRUE LOW-RES pixel art with exactly 32x32 logical pixels per square cell, displayed enlarged with nearest-neighbor. Hard square edges, opaque white/light-gray pixels only. Thin one-pixel electric arcs, restrained compact sparks, minimal little orb. You must remove the diffuse illumination entirely: sharp solid sprite pixels floating in empty transparent air. No antialiasing or partial transparency. This is a game texture atlas, not an illustration. Preserve the 24 original frames, DO NOT invent new subjects or text.
