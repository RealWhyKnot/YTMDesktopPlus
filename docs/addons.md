# Addons

YTMDesktop+ can be extended with addons: folders of CSS, page scripts and, optionally, code that
runs inside the app. The bundled Listen Along rooms feature is an addon itself. Everything it does
(its own window, settings, Discord presence buttons, a titlebar badge, tray entries, deep links) is
available to yours too.

Before anything else: an addon with a `main` entry runs in the app's main process with the same
access as the app itself. There's no sandbox. Only install addons you trust. The app shows a
confirmation the first time you enable one.

## Quickstart

The quickest start is the working template at
[`examples/addon-template`](../examples/addon-template) in this repository.

1. Open Settings, go to the Addons tab and click "Open addons folder".
2. Copy the template folder in there, then rename the folder and the `id` in
   `manifest.json`. They have to match.
3. Restart the app. The addon appears in the Addons tab, disabled.
4. Enable it and restart once more.

You should see a badge in the title bar, settings on the addon's card, and
rounded album art in the player bar. Now edit `styles.css` while the app runs.
Saving the file applies the change straight away. For code changes, use the dev
reload described under Testing and debugging.

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
| `id`            | yes      | Lowercase letters, digits and dashes. Must equal the folder name.                              |
| `name`          | yes      | Shown on the addon's card.                                                                     |
| `version`       | yes      | Your addon's own version, semver style (`1.2.3`). Other formats only log a warning.            |
| `author`        | yes      | Shown on the card.                                                                             |
| `description`   | yes      | Shown on the card.                                                                             |
| `homepage`      | no       | An http(s) link. The card gets a Homepage button.                                              |
| `minAppVersion` | no       | Oldest app version the addon works with. An older app lists the addon but never loads it.      |
| `apiVersion`    | no       | Addon API generation the addon targets. The current generation is 1. See Versioning below.    |
| `styles`        | no       | CSS files injected into the YouTube Music view and watched for edits.                          |
| `ytmScripts`    | no       | Script files run in the YouTube Music view on every page load.                                 |
| `main`          | no       | A CommonJS entry loaded in the main process.                                                   |
| `defaultEnabled`| no       | Bundled addons only. External addons always start disabled.                                    |

All paths are relative and must stay inside the addon folder.

## Types and your editor

The whole SDK is declared in one self-contained file, `ytmd-addon.d.ts`,
generated from the app's own source. The app compiles against the same
declarations, which keeps the two in sync. The template includes a copy and a
`tsconfig.json` with `checkJs` turned on, which gives plain JavaScript full
completion and checking. Type your entry like this:

```js
/** @type {import("./ytmd-addon").AddonActivate} */
module.exports.activate = ctx => {
  // ctx is fully typed from here on
};
```

`main` is loaded with `require()` and has to be CommonJS. An addon can't load
the app's own modules or `node_modules`. Node's built-in modules work, and a
`node_modules` folder inside your addon resolves normally if you bundle
dependencies yourself. The entry can export `activate` as the module itself, as
`exports.activate`, or as `exports.default.activate`.

### styles

Each file in `styles` is injected into the YouTube Music page, watched for
edits (saving the file reapplies it live) and injected again whenever the page
reloads. A pure-CSS addon needs nothing else. It replaces the old Custom CSS
setting.

### ytmScripts

Each file runs in the YouTube Music page on every page load. A script file
must evaluate to a function, which is called after evaluation:

```js
(function () {
  document.title = "hello from my addon";
});
```

A script registered under a name (the file name without its extension) can
also be invoked from `main` with an argument and a return value. See the
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
dev reload. Everything registered through the context is unwound automatically
as well. `destroy` only needs to release what the context doesn't know about:
sockets, timers, files.

## The context

Subscriptions return an unsubscribe function, and they're all released
automatically when the addon unloads. A callback that throws doesn't take the
addon down. The error goes to the log and shows on the addon's card as a recent
error, and the addon keeps running.

- `ctx.manifest`: the addon's own manifest, as loaded.
- `ctx.log`: a scoped logger writing to the app log under `addon:<id>`.
- `ctx.paths.data`: a directory for the addon's own files.
- `ctx.app.version`: the app version.
- `ctx.settings`: per-addon saved settings. `registerDefaults` fills in only
  missing keys. There's also `get`, `set`, `onDidChange`, `registerSettingsUI`
  to declare the card's fields (it replaces the whole UI, so call it once with
  everything), and `onAction` for `button` field clicks. See the settings
  reference below.
- `ctx.memory`: per-addon in-memory state, broadcast to all app windows and
  gone on quit.
- `ctx.player`: playback state. `getState`, `getQueue`, `getPlaylistId`, the
  full-snapshot `onStateChanged` stream, and typed events through
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

- `ctx.playback`: playback control. The methods `play`, `pause`, `playPause`,
  `next`, `previous`, `toggleLike`, `toggleDislike`, `setVolume`, `volumeUp`,
  `volumeDown`, `mute`, `unmute`, `seekTo`, `setRepeatMode`, `shuffle` and
  `playQueueIndex` each return false when the page isn't loaded. `cueTrack`
  opens a track at a given position, and `getPlaylists` returns the signed-in
  account's playlists. `sendPlaybackCommand` is the low-level call behind the
  other methods, for anything they don't cover (a malformed value throws).
- `ctx.ytmview`: the YouTube Music view. `registerScript`/`runScript` for page
  scripts (registering reaches an already-loaded page immediately).
  `invokeScript(name, arg?)` runs a registered script with one structured-clone
  argument and returns a promise of its result (30s timeout).
  `onMessage(name, callback)` receives messages page scripts send up (see the
  cookbook). `insertCSS`/`watchCSSFile` add styles, and both return a handle
  with `update` and `remove`. `onLoaded` registers a hook that runs each time
  the page finishes loading.
- `ctx.innertube`: `request(endpoint, body?)` calls YouTube Music's own API
  (`music.youtube.com/youtubei/v1/...`) with the page's signed-in session.
  See the cookbook below.
- `ctx.windows`: `create(options)` for a window of your own. See Addon
  windows below.
- `ctx.ipc`: `handle`/`on` for channels namespaced to the addon
  (`addon:<id>:<channel>`). Only the app's own windows can use them, including
  windows the addon created.
- `ctx.deepLinks`: `register(command, handler)` for `ytmdplus://<command>/...`
  links.
- `ctx.discord`: `isEnabled`/`onEnabledChanged` tell you whether the user
  shares presence at all. `registerButtonsProvider` adds presence buttons
  (Discord shows at most two). `registerRemoteActivityProvider` offers a track
  playing outside this app as a stand-in while local playback has nothing to
  show. `refreshActivity` re-renders after either provider's answer changes.
- `ctx.titlebar`: `setBadge`/`onBadgeClick` for an indicator in the main
  window's title bar. The badge's `icon` is a Material Symbols ligature name.
- `ctx.tray`: `setMenuItems(items)` for entries in the app's tray menu. Each
  item is `{ label, click, enabled? }`, and an empty list removes the section.
- `ctx.theme`: the theme the user picked. `get()` returns its id, name and
  resolved CSS tokens (`--bg`, `--accent`, `--font-ui` and the rest), and
  `onChanged` runs when they switch. Use it whenever you draw your own UI and
  your UI follows the theme instead of using one fixed set of colours. Styles
  you inject with `ctx.ytmview.insertCSS` can use the tokens directly, because
  the theme layer defines them in the page. See [themes.md](themes.md).
- `ctx.notifications.show`: desktop notifications.

## Page-script cookbook

Inside the page, `window.__YTMD_HOOK__.ytmStore` is the page's own frozen
store handle: `getState`, `dispatch`, `subscribe`. The template's
`page.script.js` reads from it defensively. The store's structure belongs to
YouTube Music and changes without notice.

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

A page script can also post to its addon's main-process half at any time. The
payload arrives at `ctx.ytmview.onMessage`:

```js
// in the page
window.ytmd.postAddonMessage("my-addon", "levels", { peak: 0.8 });
```

```js
// in index.js
ctx.ytmview.onMessage("levels", payload => {
  ctx.log.info("peak", payload);
});
```

The bundled Listen Along rooms addon streams its encoded audio batches
through this channel.

### Calling the YouTube Music API

`ctx.innertube.request` sends a POST to `music.youtube.com/youtubei/v1/` with
the page's own session and authorization, and resolves the parsed response.
Endpoints you'll use include `browse`, `player`, `search` and `next`:

```js
const history = await ctx.innertube.request("browse", { browseId: "FEmusic_history" });
const details = await ctx.innertube.request("player", { videoId: "dQw4w9WgXcQ" });
```

It needs a signed-in page and goes through the page-script pipeline, with the
same 30s timeout. It's an unofficial API and responses can change at any time.
Check every field before you use it. The bundled Phone playback addon uses it
for its history polling.

## Addon windows

`ctx.windows.create` opens a frameless window and takes exactly one of:

- `entry`, a renderer folder compiled into the app (bundled addons only), or
- `file`, an HTML file inside your addon folder.

Pass `show: false` to keep the window hidden and exempt from background
throttling. That's for windows that do work and aren't meant to be seen.
`handle.show()` shows it later.

```js
const win = ctx.windows.create({ file: "panel.html", width: 360, height: 240, title: "My panel" });
ctx.ipc.handle("greet", () => "hello from main");
win.send("refresh");
```

A `file` window is sandboxed and context-isolated, and gets a bridge at
`window.ytmdAddon` with everything already namespaced to your addon:

- `addonId`
- `invoke(channel, ...args)` / `send(channel, ...args)` / `on(channel, listener)`,
  which reach your `ctx.ipc.handle` and `ctx.ipc.on` registrations
- `settings.getAll()` / `settings.onChanged(callback)`
- `memory.getAll()` / `memory.onChanged(callback)`
- `closeWindow()`

The window is frameless. Your HTML supplies its own drag region
(`-webkit-app-region: drag`) and a close control that calls
`ytmdAddon.closeWindow()`. The handle returned by `create` has `show`,
`close`, `isOpen`, `webContents` and `send(channel, ...args)`.

A `file` window is themed for you. It gets the active theme's tokens plus a
few ready-made classes (`ytmd-card`, `ytmd-row`, `ytmd-button`, `ytmd-input`,
`ytmd-muted`, `ytmd-drag`, `ytmd-no-drag`), and a panel looks like the rest of
the app without any styling of your own. Add `primary` next to `ytmd-button`
for an accent-filled call to action. Keyboard focus outlines are included. The
template's `panel.html` is a working example. Build on those classes and your
window follows whatever theme the user picks. Pass `themed: false` to `create`
if you'd rather style the whole thing yourself.

Channel namespacing keeps addons from colliding. It isn't a security boundary
between them, because every addon runs with full app access anyway.

## Settings fields

`registerSettingsUI` takes sections of fields. Values are stored in the addon's
own settings namespace and go through the normal staged save flow: they apply
when the user clicks Save. Defaults come from `registerDefaults`. Field types:

- `toggle`: a switch bound to a boolean.
- `text`: a text input, with optional `placeholder` and `maxlength`.
- `number`: a slider by default, or a plain input with `display: "input"`.
  Optional `min`, `max`, `step`.
- `select`: a dropdown over `options: [{ label, value }]`. Values can be
  strings or numbers and come back with that exact type.
- `button`: a clickable row with no stored value. `buttonText` is the label
  on the button, and clicks go to `ctx.settings.onAction(key, callback)`
  immediately, without a save.

## Testing and debugging

Set `YTMD_ADDON_DEV=1` when starting a development build and the app watches
every external addon folder. Saving a file tears the addon down (running its
`destroy`), clears the module cache and activates the new code without a
restart. Settings the addon saved are kept across a reload. Anything it leaked
outside `destroy` (timers, sockets) isn't cleaned up for it, and that only
affects the current session.

Logs go to the app log (`logs/main.log` under the app's user data folder),
with every addon line stamped `(addon:<id>)`. The addon's card in Settings
has a "Copy recent log" button that copies that addon's recent lines. Any
callback that throws shows up on the card as a recent error, and the addon
keeps running.

Addon logic can be unit-tested like any Node code. Keep it in plain modules
your entry wires to `ctx`, then give your tests a stub context. The app's own
addon tests in [`tests/`](../tests) work that way.

## Versioning and compatibility

An addon loads only if it passes both of these checks:

- `minAppVersion` compares against the app version and keeps an addon off
  apps older than what it needs.
- `apiVersion` is the addon API generation the addon targets. The current
  generation is 1. New context members are added without bumping it. Only a
  breaking change to existing members would. An addon declaring a newer
  generation than the app supports is listed as incompatible, and its card
  shows "Requires a newer app (addon API v2)" or similar.

## Troubleshooting

A broken addon never stops the app from starting. Whatever went wrong (a bad
manifest, a folder name mismatch, an `activate` that throws) shows up on the
addon's card in Settings, and the details go to the app log. Runtime errors
after activation appear on the card too, without disabling the addon. On quit,
`destroy` gets a few seconds before the app closes anyway.
