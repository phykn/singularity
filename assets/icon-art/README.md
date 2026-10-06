# Generated game artwork

The current artwork was created with the built-in image generation tool. Skill illustrations were reinterpreted as detailed pixel icons. Particle illustrations were simplified into quiet, flat pixel sprites for crowded gameplay, using broad color clusters, minimal highlights and distinct silhouettes.

| Source                  | Pixel artwork             | Runtime atlas                     |
| ----------------------- | ------------------------- | --------------------------------- |
| `concept.png`           | `pixel-art.png`           | `src/ui/assets/skills.png`        |
| `particles-concept.png` | `particles-pixel-art.png` | `src/render/assets/particles.png` |

Run `npm run build:art` from the repository root to pack the selected pixel artwork. It needs the project's Playwright browser. Packing trims transparent cell margins, preserves aspect ratio and alpha, and uses nearest-neighbor sampling into 32×32 cells with two-pixel padding. It does not perform the artistic pixel conversion. Source illustrations are not shipped in the game bundle.

The skill atlas has seven columns and three rows. Its order is Attack Power, Attack Speed, Range, Move Speed, Mass Vent, Repeat, Fork; Chain, Pierce, Death Arc, Thunderstrike, Repulsion, Focus, Ball Lightning; Capacitor, Arc Bridge, Gather, Short Circuit, Pursuit Arc, Surge, Return Arc. See `src/ui/iconAtlas.ts` for runtime coordinates.

The particle atlas has three columns and two rows: Electron, Electron Surge, Quark; Muon, Proton, Neutron. Native gameplay texture sizes remain 13, 13, 11, 13, 15 and 17 pixels respectively. See `src/render/particleAtlas.ts`. UI guide icons use the 32-pixel artwork directly. Enemy movement, collision and combat rules do not depend on these assets.

## Generation prompts

### Skill source

Create one cohesive illustrated game UI icon atlas for SINGULARITY, a dark space/electricity survival game. Exactly seven columns and three rows, twenty-one isolated symbols on a truly transparent background. Equal square cells, centered symbols, generous empty margins, no backgrounds, frames, labels or text. Precise elegant silhouettes, restrained beveled surfaces, ivory edge highlights, limited tonal shading and electrical sci-fi material detail. Keep the following order and dominant colors:

1. Orange diagonal sword; green sword with speed trails; cyan targeting reticle; gold futuristic boot with speed trails; green relief plus; two teal lightning bolts; gold three-branch electrical line.
2. Three green nodes joined in a zigzag; purple arrow piercing two targets; pink spark connecting four surrounding nodes; orange vertical strike with impact sparks; blue arrow pushing a wave; three violet rays converging on one node; cyan electrical sphere.
3. Gold capacitor with internal lightning; blue terminals joined by a suspended live wire; four violet arrows gathering into a central node; pale-green bolt between brackets; orange guided arrow entering a target reticle; gold electrical starburst, not fire; blue U-turn arrow.

### Skill pixel conversion

Convert the source atlas into polished authentic 32×32 pixel-art game UI sprites. Preserve every identity, color, orientation and the exact seven-column three-row order. Carefully redraw into purposeful pixels, rather than applying blur or a pixelation filter. Preserve readable sword bevels, boot laces and sole, electrical cores, capacitor ribs and terminals. One-pixel stepped contours, clean highlights, material shadows, restrained palette, transparent background, no text or tile frames. Normalize each subject inside its square cell with transparent margins. No soft glow, noisy pixels or anti-aliasing.

### Particle source

Using the skill illustrations as a style reference only, generate a matching original illustrated particle atlas. Exactly six isolated abstract quantum particle sprites, three equal square columns and two rows, transparent gutters, centered subjects. No faces, text, atom logos, flight trails or scenery. Preserve this order: cyan electron orb with bright core and subtle electrical seams; identical energized gold electron; smaller salmon/copper faceted quark; lavender diagonal twin-lobed muon with linked luminous cores; beige-gold spherical proton with broad bright core; steel-blue neutron with a dark core and pale outer shell. Make each form recognizable when tiny.

### Particle pixel conversion

Use case: style-transfer. Edit target: the six-particle atlas. Redraw these six sprites much more simply for a crowded dark pixel-art survival game, where hundreds of particles are visible at 11–17 screen pixels. Deliver one transparent PNG atlas with exactly three equal square columns and two rows, generous transparent gutters, one centered sprite per cell. Exact order: top row cyan electron, gold electron surge, salmon/coral quark; bottom row violet muon, pale-gold proton, slate-blue neutron. Preserve identity and overall silhouette but entirely remove elaborate surface decoration.

Art direction: calm, clean, minimal flat pixel art, as if made directly on a 16×16 pixel grid. Each sprite uses two or three solid colors, broad uninterrupted color clusters and crisp stepped edges. No gradients, glossy faceted surfaces, white starburst cores, veins, electrical cracks, bright mesh, sparkles, noisy scattered pixels, glow or halos. Do not merely blur the detailed original; redraw its basic silhouette as restrained minimalist pixel art.

Cyan electron is a small plain round cyan bead with a dark blue edge and one tiny subdued lighter-cyan upper-left highlight. Surge electron uses the identical round silhouette in golden yellow with a dark amber edge and a small soft-yellow solid pixel highlight, not white. Quark is a plain small coral rounded diamond with a dark red edge and one subdued salmon highlight. Muon is a simple diagonal elongated capsule/dumbbell with two purple lobes and a short thick solid connector, no individual glowing cores, at most one small lavender highlight. Proton is a larger plain pale-gold round bead with dark ochre edge and one subdued cream highlight, no brilliant central core. Neutron is a larger simple slate-blue ring with an unpatterned dark blue center, at most one gray-blue highlight.

All six forms have similarly quiet brightness and only minimal shading. Their subject bounds occupy about 65% of each square cell. Pure transparent alpha outside the silhouettes; no black canvas, checkerboard, background fog, tile outlines, text, labels, atom diagrams or additional objects. Pixel art should stay clean at native small game size and visually quiet in a crowded field.
