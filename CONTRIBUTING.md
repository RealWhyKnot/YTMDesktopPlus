# Contributing to YTMDesktop+

I maintain YTMDesktop+ alone. For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.

## Setting up

You need Node.js 22.12 or newer and Git. Node 25 and later don't bundle corepack, so install it first with `npm install --global corepack`.

```bash
git clone https://github.com/RealWhyKnot/YTMDesktopPlus.git
cd YTMDesktopPlus
corepack enable
yarn install
yarn start
```

`yarn install` also sets up the Husky hooks. The pre-commit hook formats and lints staged files, and the commit-msg hook checks the subject format.

## Checks

- `yarn lint`, `yarn typecheck` and `yarn prettier` run the static checks.
- `yarn test` runs the unit tests.
- `node tools/test-harness/run.mjs boot-hooks` checks the app's hooks against the live YouTube Music page. The other scenarios are in `tools/test-harness/scenarios`.

CI runs the static checks and unit tests on every pull request, then builds the installers.

## Building installers

`yarn make` builds the installers for your platform into `out/make`.

Linux package builds need `fakeroot`, `dpkg` and `rpm`. AppImage builds need `mksquashfs` from `squashfs-tools`. For Flatpak, install `flatpak`, `flatpak-builder` and `elfutils`, then add Flathub:

```bash
flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

To build one format, use `yarn make --arch x64 --targets flatpak` or `--targets AppImage`. The target must be the maker's name. Using `@electron-forge/maker-flatpak` builds with the default configuration.

## Pull requests

1. Fork and branch off `main`.
2. Keep the change small. A cleanup you noticed on the way goes in its own PR.
3. Make sure the checks above pass.
4. Open the PR and fill in the template.

Commit subjects look like `type(scope): summary`, where `type` is one of `feat`, `fix`, `refactor`, `perf`, `style`, `docs`, `test`, `build`, `ci`, `chore` or `revert`.

## Themes and addons

[docs/themes.md](docs/themes.md) and [docs/addons.md](docs/addons.md) cover how both work. A new theme is CSS only and has to pass the theme checks in `yarn test`.
