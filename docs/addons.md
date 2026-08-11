# Addons

YTMDesktop+ can be extended with addons: folders of CSS, page scripts and
optionally code that runs inside the app. The bundled Listen Along rooms
feature is itself an addon, so everything it does (its own window, settings,
Discord presence buttons, a titlebar badge, deep links) is available to yours.

A word of caution before anything else: an addon with a `main` entry runs in
the app's main process with the same access as the app itself. There is no
sandbox. Only install addons you trust, and expect the app to ask for
confirmation the first time you enable one.

## Installing an addon

1. Open Settings, go to the Addons tab and click "Open addons folder".
2. Drop the addon's folder in there. The folder name must match the `id`
   in its manifest.
3. Restart the app. The addon appears in the Addons tab, disabled.
4. Enable it and restart once more. Disabling works the same way: the addon
   is fully unloaded on the next launch.

## Anatomy of an addon

```
my-addon/
  manifest.json      required
  styles.css         optional, listed under "styles"
  tweak.js           optional, listed under "ytmScripts"
  index.js           optional, listed under "main"
```

### manifest.json

```json
{
  "id": "my-addon",
  "name": "My Addon",
  "version": "1.0.0",
  "author": "you",
  "description": "One sentence about what it does.",
  "minAppVersion": "2026.811.0",
  "styles": ["styles.css"],
  "ytmScripts": ["tweak.js"],
  "main": "index.js"
}
```

- `id` is lowercase letters, digits and dashes, and must equal the folder name.
- `minAppVersion` is optional; an addon that needs a newer app is listed but
  never loaded.
- All paths are relative and must stay inside the addon folder.

### styles

Each file in `styles` is injected into the YouTube Music page, watched for
edits (saving the file reapplies it live) and re-injected whenever the page
reloads. A pure-CSS addon needs nothing else; this is the replacement for the
old Custom CSS setting.

### ytmScripts

Each file runs in the YouTube Music page on every page load. A script file
must evaluate to a function, which is called after evaluation:

```js
(() => {
  return () => {
    document.title = "hello from my addon";
  };
})();
```

Inside the page you can use `window.__YTMD_HOOK__.ytmStore` (the page's
frozen redux store handle: getState, dispatch, subscribe).

### main

`main` points at a CommonJS module loaded in the main process. It exports an
`activate` function that receives the addon context and may return an object
with a `destroy` method:

```js
module.exports.activate = ctx => {
  ctx.log.info("hello");

  ctx.settings.registerDefaults({ greeting: "hi" });
  ctx.settings.registerSettingsUI([
    { fields: [{ key: "greeting", type: "text", label: "Greeting" }] }
  ]);

  const unsubscribe = ctx.player.onStateChanged(state => {
    // react to playback
  });

  return { destroy: () => unsubscribe() };
};
```

## The context

- `ctx.log` - a scoped logger writing to the app log.
- `ctx.paths.data` - a directory for the addon's own files.
- `ctx.app.version` - the app version.
- `ctx.settings` - per-addon persisted settings: `registerDefaults`, `get`,
  `set`, `onDidChange`, and `registerSettingsUI` to declare fields (toggle,
  text, number, select) that show up on the addon's card in Settings and go
  through the normal save flow.
- `ctx.memory` - per-addon in-memory state, broadcast to all app windows.
- `ctx.ytmview` - the YouTube Music view: `registerScript`/`runScript` for
  page scripts, `invokeScript(name, arg?)` to run a registered script with one
  JSON argument and get its return value back as a promise (30s timeout),
  `insertCSS`/`watchCSSFile` for styles, `onLoaded` for a hook that fires each
  time the page finishes loading.
- `ctx.player` - `getState` and `onStateChanged` for playback state.
- `ctx.playback` - `cueTrack` and `sendPlaybackCommand`.
- `ctx.windows` - `create({ entry, width, height })` for windows whose
  renderer ships with the app.
- `ctx.ipc` - `handle`/`on` for channels namespaced to the addon and guarded
  to the app's own windows.
- `ctx.deepLinks` - `register(command, handler)` for `ytmdplus://<command>/...`
  links (`play` is reserved).
- `ctx.discord` - `registerButtonsProvider` to contribute presence buttons
  (Discord shows at most two), `registerRemoteActivityProvider` to offer a
  track playing outside this app as a presence stand-in while local playback
  has nothing to show (call `refreshActivity` after the value changes), and
  `refreshActivity`.
- `ctx.titlebar` - `setBadge`/`onBadgeClick` for an indicator in the main
  window's title bar.
- `ctx.notifications.show` - desktop notifications.

## Troubleshooting

A broken addon never stops the app from starting. Whatever went wrong (bad
manifest, folder name mismatch, a throwing `activate`) shows up on the
addon's card in Settings, and details land in the app log.
