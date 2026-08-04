# Changelog

## Unreleased
- feat(listen-along): open a room automatically while discord presence is shared

## [v2026.804.0-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.804.0-beta) - 2026-08-04
- ci(release): pre-create the release so platform publishes cannot race, keep builds independent, current action majors
- test(harness): audio capture capability probe and live stream scenario
- feat(listen-along): stream room audio and artwork to browser listeners
- fix(discord): route presence buttons through the https share page
- fix(updater): never install a build that is not newer, and skip checks on local builds
- build(scripts): install a local build over the windows installation
- docs: rooms, updater channels, loudness and explicit save in the readme
- test(harness): probe for remote device awareness in the ytm store
- feat(playback): loudness normalization from youtube's measured loudness
- fix(listen-along): retry floored decisions and seed idle listeners, add room-join scenario
- feat(listen-along): relay rooms with share links, roles and a room window
- feat(playback): allow autoplay and pause the restored track muted
- feat(updater): channel-aware feed with launch installs behind a first-run choice
- feat(settings): stage changes behind an explicit save bar
- fix(build): alias ~shared for the main process bundle
- fix(discord): point presence at the application's asset keys
- assets: add discord rich presence badge art
- revert(shortcuts): leave global accelerators unbound by default
- feat(listen-along): open and follow another player's position
- chore: use YTMDesktop+ in user-facing text
- fix(discord): reply to ping frames from the rpc socket
- fix(companion): reject a seek when no video is loaded
- ci(release): grouped commit notes with author attribution and compare footer

## [v2026.803.1](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.803.1) - 2026-08-03
- fix(release): publish immediately with prerelease flag and richer notes table

## [v2026.803.1-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.803.1-beta) - 2026-08-03

## [v2026.803.0-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.803.0-beta) - 2026-08-03
- fix(build): align executable name with package name for linux makers
