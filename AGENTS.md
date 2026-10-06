# Project guidance

- Maintain only the current game rules and code paths. Do not add legacy implementations, compatibility branches, or migration code for previous behavior.
- Keep one current checkpoint format. Do not add checkpoint versions or version-specific save/replay logic. Saved runs are read using the current rules; incompatible saves do not require migration.
- Before each push of project changes, bump the patch version using `npm version patch --no-git-tag-version` and include both `package.json` and `package-lock.json` in the pushed commit. Use an explicitly requested release version instead when provided. A retry of the same push does not need another bump. The title screen reads its version from `package.json`; do not maintain a separate display version.
- Retain the current README images and their capture script. Remove obsolete README image files instead of keeping older copies.
