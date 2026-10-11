# Keycap recordings

The embedded PCM bank in `keycaps.json` is derived from **Keyboard Soundpack #1** by **unicae_games**, published under **CC0 1.0**:

- Source: https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes
- License: https://creativecommons.org/publicdomain/zero/1.0/
- Recorded keyboard: Cherry KC 1000; microphone: Shure SM7B.

Sixteen single-key recordings supply distinct downstrokes and return contacts. Combat builds short arrangements from individual downstrokes when actual hits occur; the bank contains no prerecorded typing phrases. The build trims lead-in, softens room hiss, normalizes levels, adds boundary fades and downsamples to 22.05 kHz mono PCM. The game embeds the bank and caches rendered cues; playback needs no network request.

Rebuild from the pinned source archive with `python scripts/keycaps.py`, then apply repository formatting with `npx prettier src/audio/keycaps.json --write`. An already downloaded archive can be passed as the Python script's first argument. It verifies the source SHA-256 before processing. Keep this provenance with the bank when redistributing it.
