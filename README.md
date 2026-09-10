# YTMDesktop+

A desktop app for YouTube Music. It wraps the real music.youtube.com player, so the interface is whatever YouTube Music ships today, and adds what a browser tab can't: media keys, Discord presence, scrobbling, volume past 100%, and a local API for remote controls.

![YTMDesktop+](.github/images/readme_main_app.png)

## Download

Everything is on the [releases page](https://github.com/RealWhyKnot/YTMDesktopPlus/releases). Nightly betas go out whenever there are new changes, with debug logging on. Stable builds default to off.

On Windows the app can update itself on launch, the way Discord does. It asks once and you can change your mind later in settings. A stable install stays on stable, a nightly follows nightlies, and you can override the channel if you want to move between them.

On Debian, Ubuntu or Fedora, take the `.deb` or `.rpm`. They install to `/opt` as root, which is what lets Chromium's sandbox work, so start there if you can.

For a Steam Deck, or anywhere the deb and rpm don't fit, there's a `.flatpak`. Open it in Discover, or:

```bash
flatpak install --user ./YTMDesktopPlus-x86_64.flatpak
```

It pulls its runtime from Flathub, which SteamOS already has set up.

If you'd rather not install anything, there's an `.AppImage` for x86_64 and aarch64. Mark it executable and run it. Ubuntu 24.04 and Debian 13 need one extra step. An AppImage can't carry the setuid sandbox helper the deb and rpm rely on, and both of those releases block the fallback, so the app won't start until you add the AppArmor profile:

```bash
sudo cp packaging/apparmor/ytmdesktop-plus /etc/apparmor.d/ytmdesktop-plus
sudo apparmor_parser -r /etc/apparmor.d/ytmdesktop-plus
```

On those two, the deb is less hassle.

## Features

- The full YouTube Music player, signed in to your own account
- Listen Along rooms, so friends hear what you hear in sync
- Discord rich presence
- Last.fm scrobbling
- Media keys and global shortcuts
- Notifications on song change
- Volume past 100%, with a limiter holding the peaks down. The boosted part of the slider turns a warning colour
- Ad blocking, off by default
- Phone playback: while the desktop sits idle, the player bar and your Discord presence show what the same account is playing on your phone
- Addons, which are folders of CSS, page scripts or code you drop in and manage from settings. Custom CSS lives here now, and rooms ship as one. See [docs/addons.md](docs/addons.md)
- A companion server on port 9863, REST and WebSocket, for remote control apps. Needs a one-time authorization
- `ytmdplus://play/<videoId>` links, including a Listen Along button on your presence that drops people in where you are

Settings from an older YouTube Music Desktop App install carry over on first launch, sign-in included.

## Listen Along rooms

Start a room from the tray menu and share the link. While you host it also shows up as a Join Room button on your Discord presence, and there's an 8 letter code for anyone not on Discord. Everyone arrives as a listener and follows your playback. Promote someone and they can skip, seek, pause and change the track for the room.

The same link opens a web player that streams your audio live with the title and artwork, in any current browser. Web listeners stay anonymous and never appear in the roster. Your local volume doesn't change what the room hears, though muting the app mutes them too.

While Discord presence is on, the app opens a room by itself so the buttons on your profile lead somewhere. It says so when that happens, and a setting turns it off.

You pick a display name before hosting or joining, and it never comes from your account. The room service keeps no record of names, members or rooms once they close. Switch Listen Along off in settings and the app opens no connection to it at all.

## Developing

You'll need Node.js 22.12 or newer, and Git.

```bash
git clone https://github.com/RealWhyKnot/YTMDesktopPlus.git
cd YTMDesktopPlus
corepack enable
yarn install
yarn start
```

- `yarn lint`, `yarn typecheck`, `yarn prettier` - static checks
- `yarn test` - unit tests
- `node tools/test-harness/run.mjs boot-hooks` - checks the app still hooks the live YouTube Music page. More scenarios in `tools/test-harness/scenarios`
- `yarn make` - builds installers into `out/make`

Building on Linux needs `fakeroot`, `dpkg` and `rpm` for the deb and rpm, and `mksquashfs` from `squashfs-tools` for the AppImage. The flatpak wants `flatpak`, `flatpak-builder`, `elfutils` and the Flathub remote (`flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo`).

For a single target, pass the maker's name rather than its package name: `yarn make --arch x64 --targets flatpak`, or `--targets AppImage`. Forge matches `--targets` against the maker's own `name`, so `@electron-forge/maker-flatpak` quietly builds a default flatpak instead of the configured one.

## License

GPL-3.0. Based on [ytmdesktop](https://github.com/ytmdesktop/ytmdesktop) (GPL-3.0); modified since August 2026. The original history is preserved on the `upstream` branch.

YTMDesktop+ has no affiliation with Google or YouTube.
