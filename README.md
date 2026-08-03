# YTMDesktopPlus

A desktop app for YouTube Music. It wraps the real music.youtube.com player, so the interface always matches the current web version, and adds the things a browser tab can't do: media keys and global shortcuts, Discord rich presence, Last.fm scrobbling, native notifications, custom CSS, and a remote control API for companion apps.

![YTMDesktopPlus](.github/images/readme_main_app.png)

## Download

Grab the installer for your platform from [releases](https://github.com/RealWhyKnot/YTMDesktopPlus/releases). Windows builds update themselves automatically. Nightly beta builds are published when there are new changes and ship with debug logging enabled by default; stable builds keep logging off unless you turn it on in settings.

## Features

- The full YouTube Music web player with your existing account
- Global shortcuts and media key support
- Discord rich presence
- Last.fm scrobbling
- Native notifications on song change
- Custom CSS injection with live reload
- Companion server: a local REST and WebSocket API on port 9863 that remote control apps can use after a one-time authorization
- `ytmdplus://play/<videoId>` protocol links

Settings from a previous YouTube Music Desktop App installation, including your sign-in, are picked up automatically on first launch.

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

On Linux, building the deb and rpm packages needs `fakeroot`, `dpkg`, and `rpm`.

## License

GPL-3.0. Based on [ytmdesktop](https://github.com/ytmdesktop/ytmdesktop) (GPL-3.0); modified since August 2026. The original history is preserved on the `upstream` branch.

YTMDesktopPlus has no affiliation with Google or YouTube.
