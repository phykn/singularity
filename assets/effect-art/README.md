# Electric effect artwork

Run `npm run build:art` to paint the transparent runtime atlases from `sprites.mjs`. Each mark uses solid native pixels and a small neutral palette; the renderer applies the skill color.

`effects.png` contains four frames for each of six 32×32 rows: Hit, Heavy Impact, Charge, Surge, Dissolve and Reconnection. Charge and Surge use two unequal connected arcs with an open center. Stored charge controls brightness and size. Surge keeps the electron's 16×16 spherical silhouette, warms its palette and uses one compact field. When both states are active, a short charge mark replaces the second field. Animation uses simulation time and freezes on pause.

`beams.png` contains five rank tiers, each with eight rows of four 64×16 frames: Basic, Chain, Pierce, Strike, Focus, Charge, Orbit Barrier and Return. Higher ranks add native line weight and restrained attached branches. No loose flecks or broad glow are required. Satellite echoes follow their emitting satellite; return currents reconnect to that same live emitter. Orbit Barrier follows the current orbit radius.

`npm run check:effects` checks atlas transparency, beam endpoints and sprite reuse. `npm run check:electric` captures persistent fields, satellite combinations, Return and a 240-particle crowd in portrait and landscape. `npm run check:barrier` checks bounded orbital arcs. These checks supplement the combat and rendering tests; they are not a human usability study.
