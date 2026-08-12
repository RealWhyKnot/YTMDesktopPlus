# Addons

YTMDesktop+ can be extended with addons: folders of CSS, page scripts and
optionally code that runs inside the app. The bundled Listen Along rooms
feature is itself an addon, so everything it does (its own window, settings,
Discord presence buttons, a titlebar badge, tray entries, deep links) is
available to yours.

A word of caution before anything else: an addon with a `main` entry runs in
the app's main process with the same access as the app itself. There is no
sandbox. Only install addons you trust, and expect the app to ask for
confirmation the first time you enable one.

## Quickstart

The fastest start is the working template at
[`examples/addon-template`](../examples/addon-template) in this repository.

1. Open Settings, go to the Addons tab and click "Open addons folder".
2. Copy the template folder in there, then rename the folder and the `id` in
   `manifest.json`; they must match.
3. Restart the app. The addon appears in the Addons tab, disabled.
4. Enable it and restart once more.

You should see a badge in the title bar, settings on the addon's card, and
rounded album art in the player bar. Now edit `styles.css` while the app runs:
saving the file applies the change instantly. That live style loop, plus the
dev reload described under Testing and debugging, is the everyday workflow.

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
  ytmd-addon.d.ts    optional, the SDK types for your editor
```

### manifest.json

```json
{
  "id": "my-addon",
  "name": "My Addon",
  "version": "1.0.0",
  "author": "you",
  "description": "One sentence about what it does.",
  "homepage": "https://example.com/my-addon",
  "minAppVersion": "2026.811.0",
  "apiVersion": 1,
  "styles": ["styles.css"],
  "ytmScripts": ["tweak.js"],
  "main": "index.js"
}
```

| Field           | Required | Meaning                                                                                        |
| --------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `id`            | yes      | Lowercase letters, digits and dashes; must equal the folder name.                              |
| `name`          | yes      | Shown on the addon's card.                                                                     |
| `version`       | yes      | Your addon's own version; semver shaped (`1.2.3`), loose shapes only warn in the log.          |
| `author`        | yes      | Shown on the card.                                                                             |
| `description`   | yes      | Shown on the card.                                                                             |
| `homepage`      | no       | An http(s) link; the card grows a Homepage button.                                             |
| `minAppVersion` | no       | Oldest app version the addon works with; a too-old app lists it but never loads it.            |
| `apiVersion`    | no       | Addon API generation the addon targets; the current generation is 1. See Versioning below.     |
| `styles`        | no       | CSS files injected into the YouTube Music view and watched for edits.                          |
| `ytmScripts`    | no       | Script files run in the YouTube Music view on every page load.                                 |
| `main`          | no       | A CommonJS entry loaded in the main process.                                                   |
| `defaultEnabled`| no       | Bundled addons only; external addons always start disabled.                                    |

All paths are relative and must stay inside the addon folder.

## Types and your editor

The complete SDK surface lives in one self-contained declaration file,
`ytmd-addon.d.ts`, generated from the app's own source (the app compiles
against the same declarations, so they cannot drift). The template ships a
copy plus a `tsconfig.json` that turns on `checkJs`, so plain JavaScript gets
full completion and checking. Type your entry like this:

```js
/** @type {import("./ytmd-addon").AddonActivate} */
module.exports.activate = ctx => {
  // ctx is fully typed from here on
};
```

`main` is loaded with `require()`, so ship CommonJS. The app's own modules and
`node_modules` are not reachable from an addon; Node's built-in modules are,
and a `node_modules` folder inside your addon resolves normally if you bundle
dependencies yourself. Accepted export shapes: the module itself is a
function, `exports.activate`, or `exports.default.activate`.

### styles

Each file in `styles` is injected into the YouTube Music page, watched for
edits (saving the file reapplies it live) and re-injected whenever the page
reloads. A pure-CSS addon needs nothing else; this is the replacement for the
old Custom CSS setting.

### ytmScripts

Each file runs in the YouTube Music page on every page load. A script file
must evaluate to a function, which is called after evaluation:

```js
(function () {
  document.title = "hello from my addon";
});
```

A script registered under a name (the file name without its extension) can
also be invoked from `main` with an argument and a return value; see the
cookbook below.

### main

`main` exports an `activate` function that receives the addon context and may
return an object with a `destroy` method:

```js
module.exports.activate = ctx => {
  ctx.settings.registerDefaults({ greeting: "hi" });
  ctx.settings.registerSettingsUI([{ fields: [{ key: "greeting", type: "text", label: "Greeting" }] }]);

  const unsubscribe = ctx.player.on("trackChanged", ({ current }) => {
    if (current) ctx.log.info(`Now playing ${current.title}`);
  });

  return { destroy: () => unsubscribe() };
};
```

`destroy` runs when the app quits (it gets a few seconds to finish) and on a
dev reload. Everything registered through the context is also unwound
automatically, so `destroy` only needs to release things the context does not
know about: sockets, timers, files.

## The context

Every subscription returns an unsubscribe function, and all of them are
released automatically when the addon unloads. A callback that throws is
contained: it lands in the log and on the addon's card as a recent error, and
the addon stays active.

- `ctx.manifest` - the addon's own manifest, as loaded.
- `ctx.log` - a scoped logger writing to the app log under `addon:<id>`.
- `ctx.paths.data` - a directory for the addon's own files.
- `ctx.app.version` - the app version.
- `ctx.settings` - per-addon persisted settings: `registerDefaults` (fills
  only missing keys), `get`, `set`, `onDidChange`, `registerSettingsUI` to
  declare the card's fields (it replaces the whole UI, so call it once with
  everything), and `onAction` for `button` field clicks. See the settings
  reference below.
- `ctx.memory` - per-addon in-memory state, broadcast to all app windows and
  gone on quit.
- `ctx.player` - playback state: `getState`, `getQueue`, `getPlaylistId`, the
  full-snapshot `onStateChanged` stream, and typed granular events through
  `on(event, callback)`:

  | Event               | Payload                                        |
  | ------------------- | ---------------------------------------------- |
  | `trackChanged`      | `{ current, previous, playlistId }`            |
  | `playStateChanged`  | `{ playing, trackState }`                      |
  | `volumeChanged`     | `{ volume, muted }`                            |
  | `seeked`            | `{ fromSeconds, toSeconds }`                   |
  | `adStateChanged`    | `{ adPlaying }`                                |
  | `queueChanged`      | `{ queue }`                                    |
  | `likeChanged`       | `{ likeStatus, videoId }`                      |
  | `repeatModeChanged` | `{ repeatMode }`                               |

- `ctx.playback` - control: named methods (`play`, `pause`, `playPause`,
  `next`, `previous`, `toggleLike`, `toggleDislike`, `setVolume`, `volumeUp`,
  `volumeDown`, `mute`, `unmute`, `seekTo`, `setRepeatMode`, `shuffle`,
  `playQueueIndex`), each returning false when the page is not up;
  `cueTrack` to open a track and land at a position; `getPlaylists` for the
  signed-in account's playlists; and `sendPlaybackCommand` as the low-level
  escape hatch behind the named methods (a malformed value throws).
- `ctx.ytmview` - the YouTube Music view: `registerScript`/`runScript` for
  page scripts (registration reaches an already-loaded page immediately),
  `invokeScript(name, arg?)` to run a registered script with one
  structured-clone argument and get its return value back as a promise (30s
  timeout), `insertCSS`/`watchCSSFile` for styles (both return a handle with
  `update` and `remove`), `onLoaded` for a hook that fires each time the page
  finishes loading.
- `ctx.innertube` - `request(endpoint, body?)` calls YouTube Music's own API
  (`music.youtube.com/youtubei/v1/...`) with the page's signed-in session.
  See the cookbook below.
- `ctx.windows` - `create(options)` for a window of your own; see Addon
  windows below.
- `ctx.ipc` - `handle`/`on` for channels namespaced to the addon
  (`addon:<id>:<channel>`) and guarded to the app's own windows, including
  windows the addon created.
- `ctx.deepLinks` - `register(command, handler)` for `ytmdplus://<command>/...`
  links (`play` is reserved).
- `ctx.discord` - `registerButtonsProvider` to contribute presence buttons
  (Discord shows at most two), `registerRemoteActivityProvider` to offer a
  track playing outside this app as a presence stand-in while local playback
  has nothing to show, and `refreshActivity` to re-render after either
  provider's answer changes.
- `ctx.titlebar` - `setBadge`/`onBadgeClick` for an indicator in the main
  window's title bar. The badge's `icon` is a Material Symbols ligature name.
- `ctx.tray` - `setMenuItems(items)` for entries in the app's tray menu; each
  item is `{ label, click, enabled? }`, and an empty list removes the section.
- `ctx.notifications.show` - desktop notifications.

## Page-script cookbook

Inside the page, `window.__YTMD_HOOK__.ytmStore` is the page's own frozen
store handle: `getState`, `dispatch`, `subscribe`. The template's
`page.script.js` reads from it defensively; its shape is YouTube Music's and
changes without notice.

A round trip from `main` into the page and back:

```js
// scripts/probe.script.js: evaluates to a function taking one argument
(function (selector) {
  return document.querySelectorAll(selector).length;
});
```

```js
// index.js
ctx.ytmview.registerScript("probe.script", probeSource);
const count = await ctx.ytmview.invokeScript("probe.script", "ytmusic-player-bar");
```

Scripts listed in `manifest.json` under `ytmScripts` are registered for you
(named after the file without its extension) and run on every page load.

### Calling YouTube Music's API

`ctx.innertube.request` sends a POST to `music.youtube.com/youtubei/v1/` with
the page's own session and authorization, and resolves the parsed response.
Useful endpoints include `browse`, `player`, `search` and `next`:

```js
const history = await ctx.innertube.request("browse", { browseId: "FEmusic_history" });
const details = await ctx.innertube.request("player", { videoId: "dQw4w9WgXcQ" });
```

This needs a signed-in page and rides the page-script pipeline with its 30s
timeout. It is an unofficial API: response shapes can change at any time, so
walk them defensively. The bundled Phone playback addon does exactly this for
its history polling.

## Addon windows

`ctx.windows.create` opens a frameless window and takes exactly one of:

- `entry` - a renderer folder compiled into the app (bundled addons only), or
- `file` - an HTML file inside your addon folder.

```js
const win = ctx.windows.create({ file: "panel.html", width: 360, height: 240, title: "My panel" });
ctx.ipc.handle("greet", () => "hello from main");
win.send("refresh");
```

A `file` window is sandboxed and context-isolated, and gets a bridge at
`window.ytmdAddon` with everything already namespaced to your addon:

- `addonId`
- `invoke(channel, ...args)` / `send(channel, ...args)` / `on(channel, listener)`
  reaching your `ctx.ipc.handle` and `ctx.ipc.on` registrations
- `settings.getAll()` / `settings.onChanged(callback)`
- `memory.getAll()` / `memory.onChanged(callback)`
- `closeWindow()`

The window is frameless, so your HTML supplies its own drag region
(`-webkit-app-region: drag`) and a close control that calls
`ytmdAddon.closeWindow()`. The handle returned by `create` has `show`,
`close`, `isOpen`, `webContents` and `send(channel, ...args)`.

Channel namespacing avoids collisions between addons; it is not a security
boundary between them, since every addon runs with full app access anyway.

## Settings fields

`registerSettingsUI` takes sections of fields; values live in the addon's own
settings namespace and go through the normal staged save flow (they apply
when the user hits Save). Defaults come from `registerDefaults`, not from the
fields. Field types:

- `toggle` - a switch bound to a boolean.
- `text` - a text input; optional `placeholder` and `maxlength`.
- `number` - a slider by default, or a plain input with `display: "input"`;
  optional `min`, `max`, `step`.
- `select` - a dropdown over `options: [{ label, value }]`; values may be
  strings or numbers and come back with that exact type.
- `button` - a clickable row with no stored value; `buttonText` is the label
  on the button and clicks arrive at `ctx.settings.onAction(key, callback)`
  immediately, without a save.

## Testing and debugging

Set `YTMD_ADDON_DEV=1` when starting a development build and the app watches
every external addon folder: saving a file tears the addon down (running its
`destroy`), clears the module cache and activates the fresh code, no restart
needed. State the addon pushed into settings survives a reload; anything it
leaked outside `destroy` (timers, sockets) does not get cleaned up for it,
which only ever hurts that session.

Logs land in the app log (`logs/main.log` under the app's user data folder),
with every addon line stamped `(addon:<id>)`. The addon's card in Settings
has a "Copy recent log" button that grabs that addon's recent lines, and any
callback that throws shows up on the card as a recent error while the addon
stays active.

Addon logic is unit-testable like any Node code: keep it in plain modules
your entry wires to `ctx`, then hand your tests a stub context. The app's own
addon tests in [`tests/`](../tests) follow that pattern.

## Versioning and compatibility

Two independent gates decide whether an addon loads:

- `minAppVersion` compares against the app version and keeps an addon off
  apps older than what it needs.
- `apiVersion` names the addon API generation the addon targets. The current
  generation is 1. New context surface is added without bumping it; only a
  break in existing surface would. An addon declaring a newer generation than
  the app serves is listed as incompatible with a clear message instead of
  failing strangely.

## Internal context (bundled addons only)

The bundled rooms addon uses two extra namespaces, `ctx.coreSettings` and
`ctx.coreMemory`, to reach app settings and memory keys it historically owns.
They are deliberately absent from `ytmd-addon.d.ts`: external addons use
`ctx.settings` and `ctx.memory`, which are namespaced and covered by the
compatibility promise above.

## Troubleshooting

A broken addon never stops the app from starting. Whatever went wrong (bad
manifest, folder name mismatch, a throwing `activate`) shows up on the
addon's card in Settings, and details land in the app log. Runtime errors
after activation appear on the card too, without disabling the addon. On
quit, `destroy` gets a few seconds before the app closes anyway.
