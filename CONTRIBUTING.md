# Contributing to YTMDesktop+

I built YTMDesktop+ for my own use first and I maintain it solo. I'm picky about how the codebase is structured, how it's styled, and how features fit together. If you hit a bug or want something changed, please [open an issue](https://github.com/RealWhyKnot/YTMDesktopPlus/issues/new/choose) instead of sending a surprise pull request. A description of the problem, steps to reproduce, or what you're trying to do helps me far more than an unannounced PR.

If you'd like to help maintain the project over time, or you have a substantial change in mind, open an issue or reach out first. I'm happy to talk through the approach and agree on code style and commit conventions before you spend time writing code.

## Setting up

You need Git and Node.js 22.18 or later. If you're on Node 23, use 23.6 or later. The tools run TypeScript directly with Node's built-in type stripping. Node 25 and later don't bundle corepack, so install it first with `npm install --global corepack`.

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
- `node tools/test-harness/run.ts boot-hooks` checks the app's hooks against the live YouTube Music page. The other scenarios are in `tools/test-harness/scenarios`.

CI runs the static checks and unit tests on every pull request, then builds the installers.

## Maintainer packaging notes

These steps are for building the installers.

`yarn make` builds the installers for your platform into `out/make`.

Linux package builds need `fakeroot`, `dpkg` and `rpm`. AppImage builds need `mksquashfs` from `squashfs-tools`. For Flatpak, install `flatpak`, `flatpak-builder` and `elfutils`, then add Flathub:

```bash
flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

To build one format, use `yarn make --arch x64 --targets flatpak` or `--targets AppImage`. The target must be the maker's name. Using `@electron-forge/maker-flatpak` builds with the default configuration.

## If we agree on a PR

- Link the issue where we settled the approach.
- Keep the change small. A cleanup you noticed on the way goes in its own PR.
- Make sure the checks above pass.
- Don't add code comments unless we agreed on one.
- Commit subjects look like `type(scope): summary`, where `type` is one of `feat`, `fix`, `refactor`, `perf`, `style`, `docs`, `test`, `build`, `ci`, `chore` or `revert`.

## Themes and addons

[docs/themes.md](docs/themes.md) and [docs/addons.md](docs/addons.md) cover how both work. A new theme is CSS only and has to pass the theme checks in `yarn test`.
