# Addon template

A working starting point for a YTMDesktopPlus addon.

1. Copy this folder into the app's addons directory (Settings -> Addons -> Open addons folder).
2. Rename the folder and the `id` in `manifest.json`; they must match.
3. Restart the app, enable the addon under Settings -> Addons, restart again.

The full guide lives in [docs/addons.md](../../docs/addons.md). Types sit in `ytmd-addon.d.ts`, and `tsconfig.json` checks `index.js` against them as you edit.
