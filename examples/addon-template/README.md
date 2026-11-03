# Addon template

A working starting point for a YTMDesktopPlus addon.

1. From the repository root, run `yarn addon:template`.
2. Copy `.vite/addon-template` into the app's addons directory (Settings -> Addons -> Open addons folder).
3. Rename the folder and the `id` in `manifest.json`. They have to match.
4. Restart the app, enable the addon under Settings -> Addons, restart again.

The TypeScript sources use the [addon SDK](../../docs/addons.md) and are checked against `ytmd-addon.d.ts`. After editing them, rebuild with `yarn addon:template` to write the JavaScript named by the manifest into `.vite/addon-template`.
