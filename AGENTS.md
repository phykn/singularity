# Project guidance

- Maintain only the current game rules and code paths. Do not add legacy implementations, compatibility branches, or migration code for previous behavior.
- Keep one current checkpoint format. Do not add checkpoint versions or version-specific save/replay logic. Saved runs are read using the current rules; incompatible saves do not require migration.
