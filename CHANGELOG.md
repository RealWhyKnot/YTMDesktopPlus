# Changelog

## Unreleased
- feat(addons): dj tempo-matches blends and mixes in library tracks
- feat(addons): dj learns tracks and picks the next one to mix
- feat(addons): windows can open hidden for background work
- feat(addons): dj addon with overlapping crossfade between tracks
- test(harness): hard-mute app audio in test runs
- test(harness): add dj stream and queue probe scenarios

## [v2026.813.0-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.813.0-beta) - 2026-08-13
- refactor: share powershell self-test preamble
- refactor: move shared scenario fixtures into harness lib
- test: manage temp dirs with shared helper
- test: reuse shared player state factories
- refactor: group window and store ipc into domain modules
- refactor: route event emitter errors through electron-log
- refactor: normalize settings store access pattern
- refactor: make integration script provider optional
- refactor: extract integration lifecycle table
- refactor: extract tray and taskbar setup
- refactor: table driven global shortcut registration
- refactor: extract deep link routing
- refactor: unify store change broadcasts
- refactor: extract config store creation and migrations
- refactor: extract shared app window factory
- refactor: consolidate ipc sender guards
- refactor: share vite config helpers
- refactor: add canonical player bar selector with drift guard
- refactor: derive like and dislike from one rating script
- style: use design tokens in ytm view loading screen
- refactor: deduplicate renderer entry bootstrap
- refactor: share window shell component
- chore: remove stale webpack comments from renderer entries
- chore: remove vestigial nested tsconfigs
- chore: remove unused control icon sources
- chore: remove unused script declaration shims
- chore: remove unused protocol constants
- ci: extract shared node setup composite action
- chore: replace deprecated husky install invocation
- chore: ignore harness run output in prettier
- ci: propagate harness exit codes in nightly canary
- refactor(addons): bundled addons use only the published context
- feat(addons): page scripts post to their addon; rooms audio drops its private sink
- refactor(rooms): room window channels ride the addon's namespaced ipc
- feat(addons): discord enablement api; rooms state lives in its own memory namespace
- docs(addons): full authoring guide held to the real surface by tests
- feat(addons): copy an addon's recent log lines from its card
- feat(logging): scoped labels ride along in the log line format
- feat(addons): live reload of external addons behind YTMD_ADDON_DEV
- feat(addons): copyable template addon loaded through the real external pipeline
- feat(addons): manifest homepage and api generation with warn-only checks
- feat(addons): richer settings fields with string selects, number inputs and action buttons
- feat(addons): page scripts registered after load reach the view live
- feat(addons): tray menu items per addon, listen along entry moves to rooms
- feat(addons): windows loading addon html through a namespaced preload bridge
- feat(addons): innertube requests through one host page script
- feat(addons): granular player events derived once from the snapshot stream
- feat(addons): typed playback commands, named methods, queue and playlist access
- fix(settings): addon settings registered after the window opens bind cleanly
- fix(addons): removed stylesheets stop riding view reloads
- fix(addons): callbacks are contained and recent runtime errors show on the card
- fix(addons): quit waits for addon destroy work, capped at three seconds
- fix(ipc): sender guards fail closed while their window is absent
- fix(addons): addon windows count as app senders for their own ipc
- style(tools): prettier over the harness scripts
- test(addons): shared compiler-checked fakes and typecheck over tests and tools
- feat(addons): self-contained sdk types emitted as ytmd-addon.d.ts
- fix(logging): drive the renderer console spy ourselves and filter Chromium's noise
- docs(readme): list ad blocking, phone playback and the boost, and drop the moved custom CSS line
- docs(readme): swap the removed normalization line for the volume boost
- feat(addons): volume boost past 100% with the boosted range coloured
- refactor(rooms): fold the audio capture into the addon that drives it
- refactor(audio): one shared page audio graph, and drop duplicate loudness normalization
- fix(ad-blocker): drop cosmetic filtering so the song menu stops breaking

## [v2026.811.1-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.811.1-beta) - 2026-08-11
- feat(addons): duration-aware mirror expiry with a one-shot lookup
- feat(discord): phone badge asset on the remote track activity
- feat(addons): phone playback addon mirroring what the phone is playing
- fix(dev): probe history poll calls innertube directly
- test(harness): stop vitest writing to the installed app's log file
- test(harness): profile seeding and action and network recorders for the probe
- feat(dev): remote playback probe compiled into dev and local builds only
- fix(ytmview): isolate optional setup modules so one failure cannot hang loading
- feat(addons): invokable page scripts and a remote track presence fallback
- test(harness): probe history and popups for remote device awareness
- feat(discord): hide presence while paused by default

## [v2026.811.0-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.811.0-beta) - 2026-08-11
- style(renderer): adopt the shared palette in the room and companion windows
- feat(addons): confirm before enabling an external addon and document the format
- feat(addons): ship listen along rooms as a bundled addon
- refactor(main): route presence buttons, titlebar badges and deep links through the addon host
- feat(addons): load addon folders and turn the custom css setting into one
- feat(addons): give addons a full host context
- feat(addons): addon manager skeleton with a settings tab
- refactor(settings): split the tabs into components around a shared staging composable
- fix(settings): keep the save bar on screen and adapt the sidebar to narrow widths
- fix(settings): resizable window and controls that wrap instead of clipping
- style(renderer): share the palette through css variables
- feat(discord): add setting to hide presence while paused

## [v2026.807.0-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.807.0-beta) - 2026-08-07
- ci(nightly-beta): skip nights with only changelog bookkeeping
- feat(playback): optional ad blocking and idle-pause prevention
- fix(companion-server): pass ws's server class to socket.io

## [v2026.805.0](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.805.0) - 2026-08-05
- Stable build of v2026.805.0-beta.

## [v2026.805.0-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.805.0-beta) - 2026-08-05
- feat(listen-along): show live room listeners in the main window title bar
- fix(loudness-normalization): inject the gain scripts as callable functions
- fix(discord-presence): keep updating the activity after a refresh with no track loaded

## [v2026.804.1-beta](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.804.1-beta) - 2026-08-04
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
