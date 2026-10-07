# Themes

A theme restyles YTMDesktop+: the app's own windows and the YouTube Music page
inside it. Colours, spacing, corners, fonts. It's CSS and nothing else. A theme
can't run code, add buttons or reach the network, and that's what makes one safe
to pass around. Installing a theme doesn't ask you to trust anybody, which an
addon does.

If you want to add behaviour or new UI instead of restyling what's there, you
want an [addon](addons.md). The loader tells you that if you put `main` or
`ytmScripts` in a theme manifest.

Sixteen themes come with the app, from pure palettes to themes with their own
fonts, structure and motion, and all of them are meant to be copied. Five are
light themes. Setting `--ytmd-scheme: light` next to a light palette is all it
takes to make one, native controls and YouTube's stubborn dark corners included.

## Making one

The quickest start is to copy a working theme.

1. Open Settings, go to Themes and pick the one closest to what you want.
2. Click **Duplicate to edit**. You get a copy in your themes folder with a new
   id, it becomes the active theme, and the folder opens.
3. Edit `theme.css` and save. The app repaints as you type, without a restart.

That live loop is the whole workflow. The card shows an eye next to any theme
being watched, which tells you editing is live.

"New theme" starts from a blank palette instead, if nothing bundled is close.
If a pair of your colours would be hard to read, the card warns you and shows
the measured contrast ratio. The bundled themes have to pass the same check.

When you're happy with it, "Export as zip" gives you one file to hand to someone
else. They install it with "Install from file". A theme folder you copy in by
hand shows up after "Rescan", and that doesn't need a restart either.

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
| `id`              | yes      | Lowercase letters, digits and dashes. Must equal the folder name.           |
| `name`            | yes      | Shown on the card.                                                          |
| `version`         | yes      | Your theme's own version, semver style.                                     |
| `author`          | yes      | Shown on the card.                                                          |
| `description`     | yes      | Shown on the card.                                                          |
| `homepage`        | no       | An http(s) link.                                                            |
| `apiVersion`      | no       | Theme API generation this targets. Current: 1.                              |
| `minAppVersion`   | no       | Oldest app version it works with. An older app lists it but never loads it. |
| `styles`          | no       | CSS applied to the app windows and the music page. Put your tokens here.    |
| `appStyles`       | no       | CSS for the app's own windows and addon panels only.                        |
| `ytmStyles`       | no       | CSS for the YouTube Music page only.                                        |
| `titleBarOverlay` | no       | Colours for the Windows caption buttons. The main process can't read CSS.   |
| `preview`         | no       | An image for the card. Without one the card shows your colours instead.     |

All paths are relative and must stay inside the theme folder.

## Tokens

Set tokens, not selectors. The app has a base layer that maps both its own
components and YouTube Music's markup onto these. Overriding `--bg` restyles the
app and the music page together. It's also why a theme keeps working when
YouTube changes their markup: the mapping is in the app, and a release fixes it
there instead of in your theme.

App tokens:

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
| `--radius` | Corner radius. Set `0px` for a squared off look |
| `--radius-lg` | Corner radius for larger surfaces |
| `--space-xs` | Spacing step |
| `--space-sm` | Spacing step |
| `--space-md` | Spacing step |
| `--space-lg` | Spacing step |
| `--titlebar-height` | Title bar height |
| `--font-ui` | Body font |
| `--font-title` | Title bar and headings |
| `--font-mono` | Room codes and anything monospaced |
| `--motion-fast` | Duration for hovers and presses |
| `--motion-base` | Duration for ordinary transitions |
| `--motion-slow` | Duration for entrances and larger movement |
| `--ease` | The easing curve motion uses |

YouTube Music page tokens. Each one defaults to the matching app token, and you
usually don't need to touch them:

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
| `--ytmd-scheme` | `light` or `dark`. Controls native scrollbars and form controls. Set it in `styles`, not `ytmStyles`, and the app's own windows switch too |
| `--ytmd-font` | Page font. Leave it alone to keep YouTube's own |

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
that flattens component styles into the page, and normal selectors work inside
its components. `Cathode` and `Millennium` both do this. Read those two when you
want to go past colours.

## Motion

Themes can animate. Write ordinary `transition` and `animation` rules in any of
your stylesheets and take durations and easing from the tokens:

```css
.sidebar li {
  transition: background-color var(--motion-fast) var(--ease);
}

ytmusic-shelf {
  animation: rise var(--motion-slow) var(--ease) both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
```

When reduced motion is turned on in the OS, the base layer sets the three
duration tokens to zero, and anything timed through them stops. An ambient loop
with a literal duration (a 60s background drift, a spinning record) isn't
covered by that. Give it your own block:

```css
@media (prefers-reduced-motion: reduce) {
  ytmusic-app::after {
    animation: none;
  }
}
```

Keep motion away from the progress bar (`#primaryProgress`). The base layer
paints it and the volume boost addon repaints it, and animating it fights both.
Leave the slider knob box (`#sliderKnob`) alone too: YouTube positions it, it's
also the volume knob, and touching it moves the dot off the timeline. Decorate
`.slider-knob-inner` under `#progress-bar` instead. A full-page overlay should
only animate `transform` and `opacity`, because animating anything else there
repaints the whole window every frame.

Animated images: `.gif` isn't on the install allowlist and a zip of your theme
would drop it. Use animated WebP, SVG or plain CSS.

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

The file is read off disk and embedded when the theme loads. That's how it works
on the music page as well as in the app. Put `--font-ui` in `styles` instead of
`appStyles` and both the app and the page use it.

If you include someone else's font, include its licence next to it. Each bundled
font has its `OFL.txt` beside it.

## Network and file limits

A theme doesn't make network requests. `@import` is stripped, and so is any
`url()` pointing at `http`, `https` or `//`. Only relative paths inside your own
folder are kept, and those are embedded instead of fetched. Anything removed
this way shows up as a note on the theme's card. If your webfont did nothing,
check there first.

I did that on purpose. A stylesheet that can fetch can report what you're
listening to, and a theme shouldn't be able to.

Installing from a zip is checked too. Entries that try to escape the folder are
refused, only the file types above are extracted, and there are limits on the
number of files and their total size once extracted.

## Themes and addons together

Both can style the music page. Theme CSS goes in first, and an addon that
restyles the player bar still overrides the theme. Addons can read your theme's
tokens and follow it, and the bundled ones do.

## When something is wrong

A broken theme never stops the app from starting. A bad manifest, a folder name
that doesn't match the id, a missing stylesheet or a stripped remote url shows
up on that theme's card in Settings, with more detail in `logs/main.log`.

If a theme is listed under **Not loaded**, the reason is on the row. The most
common one is a folder name that doesn't match the `id` in `theme.json`.
