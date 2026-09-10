# YTMDesktop+

YouTube Music in a desktop app, using the player from music.youtube.com.

![YTMDesktop+](.github/images/readme_main_app.png)

## Download

Get the app from the [releases page](https://github.com/RealWhyKnot/YTMDesktopPlus/releases). Nightly betas are published when there are new changes. Debug logging defaults to on in nightlies and off in stable builds.

On Windows, the app can update itself on launch. The app asks on first use; you can change the setting later. Updates follow your installed channel unless you select another one in settings.

For Debian or Ubuntu, use the `.deb`. For Fedora, use the `.rpm`.

On Steam Deck, install the `.flatpak` through Discover or run:

```bash
flatpak install --user ./YTMDesktopPlus-x86_64.flatpak
```

Flatpak needs the Flathub remote, which SteamOS includes.

The `.AppImage` runs without installation on x86_64 and aarch64. Make it executable before running it. On Ubuntu 24.04 and Debian 13, you'll also need the [AppArmor profile](packaging/apparmor/ytmdesktop-plus):

```bash
sudo cp packaging/apparmor/ytmdesktop-plus /etc/apparmor.d/ytmdesktop-plus
sudo apparmor_parser -r /etc/apparmor.d/ytmdesktop-plus
```

## Features

- Media keys and global shortcuts
- Discord rich presence and Last.fm scrobbling
- Song change notifications
- Volume above 100%, with a peak limiter and a warning colour on the boosted range
- Ad blocking, off by default
- Listen Along rooms with synchronised playback
- Phone playback shown in the player bar and Discord presence when the desktop is idle, using the same account
- [Themes](docs/themes.md) that restyle the app and the music page together, eight of them bundled, switched without a restart
- [Addons](docs/addons.md) for CSS, page scripts and code, managed in settings. Custom CSS and Listen Along rooms use addons
- A REST and WebSocket companion server on port 9863 for remote controls, with one-time authorization
- `ytmdplus://play/<videoId>` links and a Listen Along button on Discord to join at your playback position

You sign in with your YouTube Music account. Settings and sign-in from an older YouTube Music Desktop App install carry over on first launch.

## Listen Along rooms

Start a room from the tray menu. Friends can join through the link, the Join Room button on your Discord presence, or an 8 letter code. Listeners follow your playback. You can promote them to let them change tracks, skip, seek and pause for the room.

The link also opens a web player with live audio, track title and artwork. Web listeners are anonymous and don't appear in the roster. Your volume setting doesn't affect their audio, but muting the app mutes the stream.

Discord presence starts a room automatically and notifies you. You can disable automatic rooms in settings.

You choose a display name before hosting or joining; it isn't taken from your account. The room service doesn't retain names, members or rooms after they close. With Listen Along disabled, the app makes no connection to the room service.

## Development

You'll need Node.js 22.12 or newer and Git.

```bash
git clone https://github.com/RealWhyKnot/YTMDesktopPlus.git
cd YTMDesktopPlus
corepack enable
yarn install
yarn start
```

- `yarn lint`, `yarn typecheck`, `yarn prettier` - static checks
- `yarn test` - unit tests
- `node tools/test-harness/run.mjs boot-hooks` - check hooks against the live YouTube Music page. Other scenarios are in `tools/test-harness/scenarios`
- `yarn make` - build installers in `out/make`

Linux package builds need `fakeroot`, `dpkg` and `rpm`. AppImage builds need `mksquashfs` from `squashfs-tools`. For Flatpak, install `flatpak`, `flatpak-builder` and `elfutils`, then add Flathub:

```bash
flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

To build one format, use `yarn make --arch x64 --targets flatpak` or `--targets AppImage`. The target must be the maker's name. Using `@electron-forge/maker-flatpak` builds with the default configuration.

## License

GPL-3.0. Based on [ytmdesktop](https://github.com/ytmdesktop/ytmdesktop) (GPL-3.0), modified since August 2026. The original history is on the `upstream` branch.

YTMDesktop+ is not affiliated with Google or YouTube.
