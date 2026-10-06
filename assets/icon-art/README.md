# Generated game artwork

The skill artwork was created with the built-in image generation tool: illustrated source images, then detailed pixel-art reinterpretations. Particles use the original hand-authored pixel grids and palettes in `src/render/pixels.ts`.

| Source        | Pixel artwork   | Runtime atlas              |
| ------------- | --------------- | -------------------------- |
| `concept.png` | `pixel-art.png` | `src/ui/assets/skills.png` |

Run `npm run build:art` from the repository root to pack the selected pixel artwork. It needs the project's Playwright browser. Packing trims transparent cell margins, preserves aspect ratio and alpha, and uses nearest-neighbor sampling into 32×32 cells with two-pixel padding. It does not perform the artistic pixel conversion. Source illustrations are not shipped in the game bundle.

The skill atlas has seven columns and three rows. Its order is Attack Power, Attack Speed, Range, Move Speed, Mass Vent, Repeat, Fork; Chain, Pierce, Death Arc, Thunderstrike, Repulsion, Focus, Ball Lightning; Capacitor, Arc Bridge, Gather, Short Circuit, Pursuit Arc, Surge, Return Arc. See `src/ui/iconAtlas.ts` for runtime coordinates.

Particle textures and guide icons share hand-authored 16×16 grids at native screen scale. Their stepped silhouettes restore the early artwork: a triangular Quark, diamond Muon, faceted Proton and hollow Neutron, beside the small Electron. Transparent padding keeps the smaller particles small; the grid size does not enlarge their visible bodies. Enemy movement, collision and combat rules are unchanged.

## Generation prompts

### Skill source

Create one cohesive illustrated game UI icon atlas for SINGULARITY, a dark space/electricity survival game. Exactly seven columns and three rows, twenty-one isolated symbols on a truly transparent background. Equal square cells, centered symbols, generous empty margins, no backgrounds, frames, labels or text. Precise elegant silhouettes, restrained beveled surfaces, ivory edge highlights, limited tonal shading and electrical sci-fi material detail. Keep the following order and dominant colors:

1. Orange diagonal sword; green sword with speed trails; cyan targeting reticle; gold futuristic boot with speed trails; green relief plus; two teal lightning bolts; gold three-branch electrical line.
2. Three green nodes joined in a zigzag; purple arrow piercing two targets; pink spark connecting four surrounding nodes; orange vertical strike with impact sparks; blue arrow pushing a wave; three violet rays converging on one node; cyan electrical sphere.
3. Gold capacitor with internal lightning; blue terminals joined by a suspended live wire; four violet arrows gathering into a central node; pale-green bolt between brackets; orange guided arrow entering a target reticle; gold electrical starburst, not fire; blue U-turn arrow.

### Skill pixel conversion

Convert the source atlas into polished authentic 32×32 pixel-art game UI sprites. Preserve every identity, color, orientation and the exact seven-column three-row order. Carefully redraw into purposeful pixels, rather than applying blur or a pixelation filter. Preserve readable sword bevels, boot laces and sole, electrical cores, capacitor ribs and terminals. One-pixel stepped contours, clean highlights, material shadows, restrained palette, transparent background, no text or tile frames. Normalize each subject inside its square cell with transparent margins. No soft glow, noisy pixels or anti-aliasing.
