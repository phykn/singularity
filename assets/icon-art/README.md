# Game icon artwork

The built-in image generation tool created the current skill, stat, and control icons. All use stepped dark contours, compact beveled shading, small upper-left highlights, and clean transparent gaps. Colored gameplay symbols remain distinct from quieter slate-blue controls.

| Source                 | Contents                                                        | Runtime atlas                                                              |
| ---------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `skill-source.png`     | The first sixteen skill icons in a 4×4 grid                     | `src/art/assets/skills.png`                                                |
| `skill-new-source.png` | Later skill icons in a 4×2 grid                                 | `src/art/assets/skills.png`                                                |
| `stat-pact-source.png` | Critical, Luck and the eight pacts in a 5×2 grid                | `src/art/assets/skills.png`                                                |
| `evolution-source.png` | One evolved icon per skill in a 4×4 grid                        | `src/art/assets/skills.png`                                                |
| `interface-source.png` | Five upgrades and eight controls in a 7×2 grid; last cell empty | `src/art/assets/skills.png`, `src/art/assets/controls.png`                 |
| `app-icon-source.png`  | The app icon                                                    | `public/favicon.png`, `public/apple-touch-icon.png`, `public/icon-512.png` |
| `share-source.png`     | The link preview image                                          | `public/share.png`                                                         |

Run `npm run build:art` to reproduce the atlases with the project's Playwright browser. The packer trims transparent margins, preserves alpha and aspect ratio, and uses nearest-neighbor sampling into 32×32 cells with two-pixel padding. It only arranges and resamples completed artwork; it does not draw substitute glyphs. Only the packed atlases ship in the game bundle.

## Selection and final polish

Three complete skill sets and an initial unified set were compared at 32px and 64px. The user selected C for Chain and Death Arc; A for Thunderstrike, Repulsion, and Return; B for Capacitor and Surge; and the unified set for the other nine skills. The final artwork preserves those chosen silhouettes: two linked green nodes, curved blue repulsion waves, a twin-terminal capacitor, curved golden surge arcs, and a horizontal return arrow.

The user's selected set then received one complete image-generation edit to unify outline thickness, shading, highlights, and visual weight. The companion stat and UI atlas served as a style reference for this final pass. Full prompts are in [prompts.md](prompts.md).

## Runtime order

`skills.png` holds 32×32 cells in eight columns, in the order of `iconIds` in `src/art/skills.ts`: five stats, Mass Release, sixteen skills and eight pacts, then one evolved icon per skill. `scripts/art.mjs` maps each cell to its source sheet; some source cells belong to retired skills and are not packed.

`controls.png` contains four columns and two rows:

- GitHub, Star, Help, Settings
- Pause, Play, Next, Energy Meter

Coordinates live in `src/art/skills.ts`. The energy meter retains a dynamic clipped fill over its generated ring. Button names and accessibility semantics remain in their consuming components.

## Particles and combat effects

Particle guide icons use the exact same native 16×16 bodies and four-tone palettes as the playfield, defined in `src/art/particles.ts`. Their deliberately simpler rendering keeps dense crowds readable. Quark, Muon, Proton and Neutron have 8, 10, 12 and 14-pixel diameters; Electron uses 12 pixels and turns gold during Surge. No decorative icon detail is added to combat particles.

Combat effect artwork is maintained separately in `assets/effect-art/`. Damage values remain integer labels.
