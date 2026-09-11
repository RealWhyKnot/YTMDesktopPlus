# Themes

A theme restyles YTMDesktop+: the app's own windows and the YouTube Music page
inside it. Colours, spacing, corners, fonts. It is CSS and nothing else, so a
theme cannot run code, add buttons, or reach the network. That is what makes
one safe to pass around: unlike an addon, installing a theme does not ask you
to trust anybody.

If you want to add behaviour or new UI rather than restyle what is there, you
want an [addon](addons.md) instead. The loader will tell you so if you put
`main` or `ytmScripts` in a theme manifest.

Eight themes ship with the app. Four are pure palettes, four go further with
their own fonts and structure, and all eight are meant to be copied.

## Making one

The fastest start is to steal a working theme.

1. Open Settings, go to Themes and pick the one closest to what you want.
2. Click **Duplicate to edit**. You get a copy in your themes folder with a new
   id, it becomes the active theme, and the folder opens.
3. Edit `theme.css` and save. The app repaints as you type. No restart.

That live loop is the whole workflow. The card shows an eye next to any theme
being watched, so you can tell at a glance that editing is live.

When you are happy, **Export as zip** gives you one file to hand to someone
else. They install it with **Install from file**.

## Anatomy

```
my-theme/
  theme.json       required
  theme.css        tokens, applied everywhere
  app.css          optional, only the app's own windows
  ytm.css          optional, only the YouTube Music page
  fonts/*.woff2    optional, embedded when the theme loads
  preview.png      optional, shown on the card
```

A palette theme is `theme.json` plus one `theme.css` of about forty lines. The
other files are there for when you want to go further.

### theme.json

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "author": "you",
  "description": "One sentence about what it looks like.",
  "homepage": "https://example.com/my-theme",
  "apiVersion": 1,
  "styles": ["theme.css"],
  "appStyles": ["app.css"],
  "ytmStyles": ["ytm.css"],
  "titleBarOverlay": { "color": "#12171d", "symbolColor": "#a9b6c4" },
  "preview": "preview.png"
}
```

| Field             | Required | Meaning                                                                     |
| ----------------- | -------- | --------------------------------------------------------------------------- |
| `id`              | yes      | Lowercase letters, digits and dashes; must equal the folder name.           |
| `name`            | yes      | Shown on the card.                                                          |
| `version`         | yes      | Your theme's own version, semver shaped.                                    |
| `author`          | yes      | Shown on the card.                                                          |
| `description`     | yes      | Shown on the card.                                                          |
| `homepage`        | no       | An http(s) link.                                                            |
| `apiVersion`      | no       | Theme API generation this targets. Current: 1.                              |
| `minAppVersion`   | no       | Oldest app version it works with; an older app lists it but never loads it. |
| `styles`          | no       | CSS applied to every surface. Where your tokens belong.                     |
| `appStyles`       | no       | CSS for the app's own windows and addon panels only.                        |
| `ytmStyles`       | no       | CSS for the YouTube Music page only.                                        |
| `titleBarOverlay` | no       | Colours for the Windows caption buttons; the main process cannot read CSS.  |
| `preview`         | no       | An image for the card. Without one the card shows your colours instead.     |

All paths are relative and must stay inside the theme folder.

## Tokens

Set tokens, not selectors. The app ships a base layer that maps both its own
components and YouTube Music's markup onto these, so overriding `--bg` restyles
the app and the music page together. That is also why a theme keeps working
when YouTube changes their markup: the mapping lives in the app and gets fixed
in a release, not in your theme.

The app surface:

| Token | What it colours |
| --- | --- |
| `--bg` | Window background |
| `--bg-raised` | Cards, the player bar, panels |
| `--bg-control` | Buttons and inputs |
| `--bg-control-hover` | Those, hovered |
| `--border` | Hairlines and dividers |
| `--border-strong` | Focused and emphasised edges |
| `--text` | Body text |
| `--text-muted` | Secondary text |
| `--text-faint` | Captions and hints |
| `--accent` | The colour the app leans on |
| `--on-accent` | Text drawn on top of the accent |
| `--success` | Confirmations |
| `--danger` | Destructive actions and the close button |
| `--danger-hover` | Those, hovered |
| `--knob` | The dot in a toggle switch |
| `--overlay` | The scrim behind a modal |
| `--scrollbar-thumb` | Scrollbar thumb |
| `--titlebar-symbol` | Title bar glyphs |
| `--titlebar-separator` | Title bar dividers |
| `--shadow` | Default box shadow |
| `--radius` | Corner radius; set `0px` for a squared off look |
| `--radius-lg` | Corner radius for larger surfaces |
| `--space-xs` | Spacing step |
| `--space-sm` | Spacing step |
| `--space-md` | Spacing step |
| `--space-lg` | Spacing step |
| `--titlebar-height` | Title bar height |
| `--font-ui` | Body font |
| `--font-title` | Title bar and headings |
| `--font-mono` | Room codes and anything monospaced |

The YouTube Music surface, which defaults to the matching app token so you
usually do not touch these:

| Token | What it colours |
| --- | --- |
| `--ytmd-bg` | Page background |
| `--ytmd-surface` | Player bar and raised shelves |
| `--ytmd-elevated` | Search field and menu surfaces |
| `--ytmd-hover` | Hover and pressed fills, chip backgrounds |
| `--ytmd-border` | Dividers, outlines, the progress track |
| `--ytmd-text` | Page text |
| `--ytmd-text-muted` | Secondary page text, card subtitles |
| `--ytmd-text-faint` | Disabled text |
| `--ytmd-icon` | Icons |
| `--ytmd-icon-muted` | Disabled icons |
| `--ytmd-accent` | Progress bar and selected items |
| `--ytmd-on-accent` | Text drawn on top of the accent |
| `--ytmd-danger` | Warnings on the page, such as the boosted part of the volume bar |
| `--ytmd-overlay` | Scrims over artwork |
| `--ytmd-scheme` | `light` or `dark`; drives native scrollbars and form controls |
| `--ytmd-font` | Page font; leave it alone to keep YouTube's own |

A palette theme is one `:root` block setting the ones it cares about:

```css
:root {
  --bg: #12171d;
  --bg-raised: #1a212a;
  --text: #e3e9ef;
  --accent: #7fb3d5;
}
```

Beyond tokens you can write ordinary CSS. YouTube Music runs Polymer in a mode
that flattens component styles into the page, so normal selectors reach inside
its components. `Cathode` and `Millennium` both do this, and they are the ones
to read when you want to go past colours.

## Fonts

Drop a `.woff2` in your theme folder and point at it with a relative path:

```css
@font-face {
  font-family: "My Font";
  src: url("fonts/MyFont.woff2") format("woff2");
  font-display: swap;
}

:root {
  --font-ui: "My Font", sans-serif;
  --ytmd-font: "My Font", sans-serif;
}
```

The file is read off disk and embedded when the theme loads, so it works on the
music page as well as in the app. Put `--font-ui` in `styles` rather than
`appStyles` and both surfaces pick it up.

If you ship someone else's font, ship its licence next to it. The four bundled
fonts each sit beside their `OFL.txt`.

## What a theme cannot do

A theme makes no network requests. `@import` is stripped, and so is any `url()`
pointing at `http`, `https` or `//`. Only relative paths inside your own folder
survive, and those are embedded rather than fetched. Anything removed this way
shows up as a note on the theme's card, so you are not left guessing why your
webfont did nothing.

This is deliberate. A stylesheet that can fetch is a stylesheet that can report
what you are listening to, and a theme should never be able to do that.

Installing from a zip is checked too: entries that try to escape the folder are
refused, only the file types above are unpacked, and there are caps on how many
files and how much they unpack to.

## Themes and addons together

Both can style the music page. Theme CSS goes in first, so an addon that
restyles the player bar still wins over the theme. Addons can read your theme's
tokens and follow it, and the bundled ones do.

## When something is wrong

A broken theme never stops the app from starting, and it is never silently
ignored. A bad manifest, a folder name that does not match the id, a missing
stylesheet, a stripped remote url: all of it lands on that theme's card in
Settings, with more detail in `logs/main.log`.

If a theme is listed under **Not loaded**, the reason is on the row. The
commonest one is a folder name that does not match the `id` in `theme.json`.
