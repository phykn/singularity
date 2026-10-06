# Electric effect artwork

Run `npm run build:art` to paint the transparent runtime atlases from `sprites.mjs`. Each mark uses solid native pixels and a small neutral palette; the renderer applies the skill color.

`effects.png` contains four frames for each of three 32�32 rows: Hit, Heavy Impact and Dissolve. Electron-attached effects use procedural circles, not sprite images. Charge fills a thin warm contour with the stored charge; Surge uses a compact gold aura with a subtle brightness pulse. Both share the same radius when active together, with a pale charge segment on the gold contour. The soft edge stays faint, the center stays empty, and the electron keeps its 16�16 spherical silhouette. Animation uses simulation time and freezes on pause.

`beams.png` contains three single-hit damage tiers, each with eight rows of four 64×16 frames: Basic, Chain, Pierce, Strike, Focus, Charge, Orbit Barrier and Return. Hits below 10 damage use a one-pixel trunk, hits from 10 to below 40 use two pixels, and hits of 40 or more use three. Brightness increases gradually with damage. Skill level and rarity do not independently thicken a beam; Repeat, Multi, Chain and Satellite growth remains visible through actual shots, recipients, connections and bodies. No decorative forks are added to imply extra attacks. No loose flecks or broad glow are required. Satellite echoes follow their emitting satellite; return currents reconnect to that same live emitter. Orbit Barrier follows the current orbit radius.

Simultaneous return, discharge and surge contacts share one flash at each emitter's screen position. The highest-opacity contact supplies the color and size of a thin, fading circle. Every attack strand remains visible within the existing effect budgets; separate satellite contacts remain independent. This avoids stacked halos without changing hits, timing or damage labels.

Rendering routes live in `src/render/drawEffects.ts`: `EffectPainter.sprite` draws target impacts, `beam` draws attack strands, and `contact` queues emitter circles in `ElectronScene`. Contact radii are screen pixels; positions are world coordinates. Persistent Charge and Surge auras are drawn separately by `electronField.ts`.

`npm run check:effects` checks atlas transparency, beam endpoints and sprite reuse. `npm run check:electric` captures persistent fields, satellite combinations, Return and a 240-particle crowd in portrait and landscape. `npm run check:barrier` checks bounded orbital arcs. These checks supplement the combat and rendering tests; they are not a human usability study.
