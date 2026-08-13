# YTMDesktop+

A desktop app for YouTube Music. It wraps the real music.youtube.com player, so the interface always matches the current web version, and adds the things a browser tab can't do: media keys and global shortcuts, Discord rich presence, Last.fm scrobbling, native notifications, volume past 100%, ad blocking, and a remote control API for companion apps.

![YTMDesktop+](.github/images/readme_main_app.png)

## Download

Grab the installer for your platform from [releases](https://github.com/RealWhyKnot/YTMDesktopPlus/releases). Nightly beta builds are published when there are new changes and ship with debug logging enabled by default; stable builds keep logging off unless you turn it on in settings.

On Windows the app can install updates on launch, like Discord does. It asks once on first run and the choice can be changed in settings at any time. The update channel follows the installed build, so a stable install stays on stable and a nightly install follows nightlies, and you can override the channel in settings; changing it applies the matching update when you save.

On a Steam Deck, or any Linux distribution where the deb and rpm packages do not apply, download the `.flatpak` file from a release and open it in Discover, or install it from a terminal:

```bash
flatpak install --user ./dev.whyknot.YTMDesktopPlus_stable_x86_64.flatpak
```

The flatpak needs the Flathub remote for its runtime, which SteamOS already has set up. One limitation: Discord rich presence from inside the flatpak reaches a normally installed Discord, but not the flatpak build of Discord.

## Features

- The full YouTube Music web player with your existing account
- Listen Along rooms: friends follow your playback in sync over the internet
- Global shortcuts and media key support
- Discord rich presence
- Last.fm scrobbling
- Volume boost: takes the volume slider past 100%. The boosted part of the bar turns a warning colour, and a limiter holds the peaks down
- Ad blocking: filter lists applied to the player's own traffic, off until you turn it on
- Phone playback: while the desktop is idle, the app shows what the same account is playing on your phone, in the player bar and on your Discord presence
- Native notifications on song change
- Addons: drop-in folders of CSS, page scripts or code that extend the app, managed from the settings window (see [docs/addons.md](docs/addons.md)). Custom CSS lives here now, still with live reload; the rooms feature itself ships as one
- Companion server: a local REST and WebSocket API on port 9863 that remote control apps can use after a one-time authorization
- `ytmdplus://play/<videoId>` protocol links, including a Listen Along button on your Discord presence that opens the track where you are in it

Settings apply when you save them, and the window tells you when there are unsaved changes.

Settings from a previous YouTube Music Desktop App installation, including your sign-in, are picked up automatically on first launch.

## Listen Along rooms

Start a room from the tray menu and share the link; it also appears as a Join Room button on your Discord presence while you host. Friends join by link or by typing the 8 letter room code, so it works without Discord too. Everyone joins as a listener and follows your playback in sync; you can promote anyone to controller, which lets them skip, seek, pause, and change the track for the room.

Friends without the app are not left out: the room link opens a web player that streams your audio live, with the track title and artwork, in any current browser. Web listeners are anonymous and never appear in the roster. Streaming is on while you host and can be turned off in settings; your local volume never affects what the room hears, but muting the app mutes the stream too.

While Discord presence is on, a room opens by itself so the buttons on your profile always lead somewhere; the app tells you when that happens, the room stays anonymous unless you saved a display name, and the profile shows no Listen Along buttons at all when no room is live. Leaving the room keeps it closed for the rest of the session, and a setting turns automatic rooms off entirely.

You pick a display name before hosting or joining. It is never taken from your account, and the room service keeps no record of names, members, or rooms once they close. Turning the Listen Along toggle off in settings means the app opens no connection to the room service at all and removes the Listen Along button from your Discord presence.

## Developing

Requirements: Node.js 22.12 or newer and Git.

```bash
git clone https://github.com/RealWhyKnot/YTMDesktopPlus.git
cd YTMDesktopPlus
corepack enable
yarn install
yarn start
```

Useful commands:

- `yarn lint`, `yarn typecheck`, `yarn prettier` - static checks
- `yarn test` - unit tests
- `node tools/test-harness/run.mjs boot-hooks` - end-to-end check that the app still hooks the live YouTube Music page; more scenarios live in `tools/test-harness/scenarios`
- `yarn make` - build platform installers into `out/make`

On Linux, building the deb and rpm packages needs `fakeroot`, `dpkg`, and `rpm`. The flatpak additionally needs `flatpak`, `flatpak-builder`, `elfutils`, and the Flathub remote (`flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo`).

## License

GPL-3.0. Based on [ytmdesktop](https://github.com/ytmdesktop/ytmdesktop) (GPL-3.0); modified since August 2026. The original history is preserved on the `upstream` branch.

YTMDesktop+ has no affiliation with Google or YouTube.
