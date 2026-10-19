# Security policy

YTMDesktop+ runs addons, can open a remote control server on your network and updates itself on Windows, so I take security reports seriously.

## Reporting

Please don't open a public issue. Use [a private security advisory](https://github.com/RealWhyKnot/YTMDesktopPlus/security/advisories/new) so we can work out a fix before anything is published.

I try to reply within 7 days. There's no bug bounty.

## In scope

- Controlling the app through the companion server on port 9863 without going through its authorization.
- A theme running code, reaching the network or adding UI. Themes are meant to be CSS only.
- An addon running without the confirmation the app shows the first time you enable it, or a disabled addon running anyway.
- The music page, a `ytmdplus://` link or a Listen Along room making the app run code or read local files.
- Joining or controlling a Listen Along room without its link or code, or getting promoted without the host's say.
- The updater installing a build that didn't come from this repo's releases.

## Out of scope

- Bugs in YouTube Music itself.
- What an addon does after you've installed and enabled it. Addons have the same access as the app, as [docs/addons.md](../docs/addons.md) says.
- Attacks that need access to your computer already.
