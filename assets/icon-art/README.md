# Generated game artwork

The current artwork was created with the built-in image generation tool in two artistic stages: illustrated source images, then pixel-art reinterpretations. The final particle sheet also received a transparent-background extraction pass.

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

Redraw the same six particles as authentic 32×32 pixel-art sprites. Preserve their exact cell order, hues and recognizable shapes. Keep the cyan and gold electron silhouettes alike, the muon elongated diagonally, and the neutron dark-centered with a pale shell. Purposeful one-pixel stepped edges, solid color clusters, rim highlights, controlled shading and transparent margins. Remove backgrounds and atmospheric clouds; no labels or extra particle forms.

### Particle background extraction

Keep the six pixel-art particle designs, colors, material highlights and exact three-column two-row layout. Remove surrounding background clouds and halos. Preserve crisp silhouette edges and true alpha transparency around each sprite; no opaque cell backgrounds, text or additional objects.
