# Addon template

A working starting point for a YTMDesktopPlus addon.

1. Copy this folder into the app's addons directory (Settings -> Addons -> Open addons folder).
2. Rename the folder and the `id` in `manifest.json`. They have to match.
3. Restart the app, enable the addon under Settings -> Addons, restart again.

The full guide is [docs/addons.md](../../docs/addons.md). Types are in `ytmd-addon.d.ts`, and `tsconfig.json` checks `index.js` against them as you edit.
