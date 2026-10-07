# Linux flatpak test environment

Runs the packaged flatpak on a local Arch WSL distro. I use it to test the Linux build without a
Steam Deck on the desk.

## What this is

SteamOS 3 is based on Arch. An Arch WSL distro with flatpak runs the same bundle a Deck user
installs, against the same `org.freedesktop.Platform//25.08` runtime. WSLg provides Wayland and
X11, the app declares both sockets, and the window opens on the Windows desktop.

It reproduces packaging and integration: whether the bundle installs, whether the desktop entry,
hicolor icon and AppStream metainfo end up where a launcher will find them, whether the app boots
inside the sandbox, and whether the sandbox permissions the app declares are enough for what it
does.

It isn't SteamOS and doesn't reproduce hardware or session behaviour. There's no gamescope session,
Deck controls, Plasma desktop, immutable rootfs or real audio device. Gamepad and touch input, the
Steam overlay and audio output still need a real device.

## Use

```
node tools/steamdeck/run.mjs setup                  # provision the distro, safe to re-run
node tools/steamdeck/run.mjs run --tag v2026.820.0-beta   # install a published release and launch it
node tools/steamdeck/run.mjs build                  # build the flatpak from the working tree
node tools/steamdeck/run.mjs run                    # launch the newest local bundle
node tools/steamdeck/run.mjs shell                  # shell in the distro, as the deck user
```

`setup` expects the distro to exist already:

```
wsl --install archlinux --no-launch
```

Set `YTMD_DECK_DISTRO` to use a different distro name. `setup` also works on an apt-based distro
like Ubuntu. The flatpak runtime is the same one a Deck uses either way.

## Notes

Everything installs per user, as `deck`, the same way a Deck user installs from Discover. The tool
always names that user explicitly and works whether or not the distro's default user has been
switched over. `wsl -d archlinux` by hand still logs you in as root until the distro is restarted.

`build` copies the tree into the distro's own filesystem instead of building over `/mnt`. Building
over `/mnt` is slow, and its `node_modules` is built for Windows.

Logs from a run are at
`~/.var/app/dev.whyknot.YTMDesktopPlus/config/YTMDesktopPlus/logs/main.log` inside the distro.
