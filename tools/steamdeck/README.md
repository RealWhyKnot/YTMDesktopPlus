# Linux flatpak test environment

Runs the packaged flatpak on a local Arch WSL distro, so the Linux build can be exercised
without a Steam Deck on the desk.

## What this is

SteamOS 3 is Arch based, so an Arch WSL distro with flatpak on it runs the same bundle a Deck
user installs, against the same `org.freedesktop.Platform//25.08` runtime. WSLg supplies Wayland
and X11, and the app declares both sockets, so the window opens on the Windows desktop.

It reproduces packaging and integration: whether the bundle installs, whether the desktop entry,
hicolor icon and AppStream metainfo land where a launcher will find them, whether the app boots
inside the sandbox, and whether the sandbox holes the app declares are enough for what it does.

It is not SteamOS and does not reproduce hardware or session behaviour. No gamescope session, no
Deck controls, no Plasma desktop, no immutable rootfs, and no real audio device. Gamepad and touch
input, the Steam overlay, and audio output still need a real device.

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

Set `YTMD_DECK_DISTRO` to point the tool at a different distro name.

## Notes

Everything installs per user, as `deck`, matching how a Deck user installs from Discover. The tool
always names that user explicitly, so it works whether or not the distro's default user has been
switched over. `wsl -d archlinux` by hand still lands you on root until the distro is restarted.

`build` copies the tree into the distro's own filesystem rather than building over `/mnt`, which is
slow, and whose `node_modules` is built for Windows.

Logs from a run are at
`~/.var/app/dev.whyknot.YTMDesktopPlus/config/YTMDesktopPlus/logs/main.log` inside the distro.
