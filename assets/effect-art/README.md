# Electric effect artwork

Created with the built-in image generation tool. The selected neutral pixel artwork is `pixel-art.png`; `npm run build:art` packs it into `src/render/assets/effects.png`. Illustrated trials are not shipped.

The runtime sheet has four columns and six rows of 32×32 cells: Hit, Heavy Impact, Ball Lightning, Charge Halo, Surge Aura, Particle Dissolve. Every row contains four animation frames. Packing uses nearest-neighbor sampling of whole cells, preserving alpha and shared centers. Do not trim individual frames: it changes their registration and causes wobble.

Cells include transparent margins; their visible bodies are smaller than 32 pixels. Gameplay uses native screen pixels, with no enlargement of the original particle sprites. Short impacts follow effect lifetime; sustained effects loop on simulation time and freeze with combat. Tint follows each skill's existing color. The same sprite pool is reused each frame, and the existing effect quotas still bound busy scenes. Damage numbers and combat geometry are unchanged.

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
