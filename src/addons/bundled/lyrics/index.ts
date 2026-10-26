import type { BundledAddonDefinition } from "../../../main/addons/manager";
import type { PlayerQueue, VideoDetails } from "../../../shared/addons/sdk";
import { cleanArtist, cleanTitle, fromYtmTimed, pickLrclib, type LrclibRecord, type Lyrics, DURATION_TOLERANCE_SECONDS } from "./lyrics-data";

import fetchScript from "./scripts/fetch.script?raw";
import lyricsScript from "./scripts/lyrics.script?raw";

export const TEXT_SIZES = [
  { label: "Small", value: 18 },
  { label: "Medium", value: 22 },
  { label: "Large", value: 26 }
];

export const DEFAULT_TEXT_SIZE = 18;

export const LRCLIB_URL = "https://lrclib.net/api/search";
const LRCLIB_TIMEOUT_MS = 8000;
const CACHE_LIMIT = 50;

export function lyricsCss(size: number): string {
  const px = TEXT_SIZES.some(option => option.value === size) ? size : DEFAULT_TEXT_SIZE;
  return `
  ytmusic-tab-renderer.ytmd-lyrics-on[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"] > ytmusic-section-list-renderer {
    display: none !important;
  }

  ytmusic-tab-renderer:not(.ytmd-lyrics-on) > .ytmd-lyrics,
  ytmusic-tab-renderer:not([page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]) > .ytmd-lyrics {
    display: none;
  }

  .ytmd-lyrics {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 16px 12px var(--ytmd-lyrics-tail, 50vh) 0;
    font-size: ${px}px;
    line-height: 1.3;
    font-weight: 700;
    color: var(--ytmusic-text-primary);
  }

  .ytmd-lyrics-line {
    margin: 0 0 0.6em;
    overflow-wrap: anywhere;
    white-space: normal;
    transition: opacity 240ms ease;
  }

  .ytmd-lyrics-line.is-gap {
    height: 0.4em;
    margin: 0;
  }

  .ytmd-lyrics[data-timed="true"] .ytmd-lyrics-line {
    opacity: 0.4;
  }

  .ytmd-lyrics[data-timed="true"] .ytmd-lyrics-line[data-start] {
    cursor: pointer;
  }

  .ytmd-lyrics[data-timed="true"] .ytmd-lyrics-line[data-start]:hover {
    opacity: 0.75;
  }

  .ytmd-lyrics[data-timed="true"] .ytmd-lyrics-line.is-active {
    opacity: 1;
  }

  .ytmd-lyrics-line.is-active .ytmd-lyrics-word {
    opacity: 0.45;
    transition: opacity 120ms linear;
  }

  .ytmd-lyrics-line.is-active .ytmd-lyrics-word.is-sung {
    opacity: 1;
  }

  .ytmd-lyrics-source {
    margin-top: 24px;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.4;
    color: var(--ytmusic-text-secondary);
    overflow-wrap: anywhere;
  }

  @media (prefers-reduced-motion: reduce) {
    .ytmd-lyrics-line,
    .ytmd-lyrics-word {
      transition: none !important;
    }
  }
`;
}

export function durationFromText(text: string): number | null {
  const parts = String(text ?? "")
    .trim()
    .split(":")
    .map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function counterpartIds(queue: PlayerQueue | null, video: VideoDetails): string[] {
  const items = [...(queue?.items ?? []), ...(queue?.automixItems ?? [])];
  const selected = items.find(item => item.videoId === video.id) ?? items.find(item => item.counterparts?.some(other => other.videoId === video.id));
  if (!selected) return [];
  const renditions = [selected, ...(selected.counterparts ?? [])];
  return renditions
    .filter(item => item.videoId !== video.id)
    .filter(item => {
      const seconds = durationFromText(item.duration);
      return seconds !== null && Math.abs(seconds - video.durationSeconds) <= DURATION_TOLERANCE_SECONDS;
    })
    .map(item => item.videoId);
}

type PagePayload = { videoId: string; pending?: boolean; lines: Lyrics["lines"] | null; timed?: boolean; source?: string | null };

const lyricsAddon: BundledAddonDefinition = {
  manifest: {
    id: "lyrics",
    name: "Synced lyrics",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Shows the Lyrics tab in large type and highlights each line as it's sung. Click a line to jump to it.",
    defaultEnabled: true
  },

  activate(ctx) {
    ctx.settings.registerDefaults({ textSize: DEFAULT_TEXT_SIZE, lrclib: true });
    ctx.settings.registerSettingsUI([
      {
        fields: [
          {
            key: "textSize",
            type: "select",
            label: "Text size",
            options: TEXT_SIZES
          },
          {
            key: "lrclib",
            type: "toggle",
            label: "Look up missing timings on LRCLIB",
            description:
              "If YouTube Music has no synced lyrics for a song, look for them on lrclib.net. This sends the song's title, artist and length to lrclib.net."
          }
        ]
      }
    ]);

    ctx.ytmview.registerScript("fetch", fetchScript);
    ctx.ytmview.registerScript("render", lyricsScript);

    const cache = new Map<string, Lyrics | null>();
    let generation = 0;
    let disposed = false;

    const remember = (videoId: string, lyrics: Lyrics | null) => {
      cache.delete(videoId);
      cache.set(videoId, lyrics);
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    };

    const push = async (payload: PagePayload | { disable: true }) => {
      try {
        await ctx.ytmview.invokeScript("render", payload);
      } catch (error) {
        ctx.log.warn("Synced lyrics could not reach the page", error);
      }
    };

    const fromYtm = async (videoId: string): Promise<Lyrics | null> => {
      const result = (await ctx.ytmview.invokeScript("fetch", { videoId })) as { lines?: unknown; source?: unknown } | null;
      if (!result || !Array.isArray(result.lines)) return null;
      const lyrics = fromYtmTimed(result.lines);
      if (!lyrics || lyrics.lines.every(line => !line.text)) return null;
      return { ...lyrics, source: typeof result.source === "string" ? result.source : "" };
    };

    const fromLrclib = async (video: VideoDetails, reference: Lyrics | null): Promise<Lyrics | null> => {
      const title = cleanTitle(video.title);
      const artist = cleanArtist(video.author);
      if (!title) return null;
      const target = {
        durationSeconds: video.durationSeconds,
        referenceText: reference ? reference.lines.map(line => line.text).join("\n") : null
      };
      const queries = [new URLSearchParams({ track_name: title, artist_name: artist }), new URLSearchParams({ q: `${title} ${artist}`.trim() })];
      for (const query of queries) {
        const response = await fetch(`${LRCLIB_URL}?${query}`, {
          headers: { "User-Agent": `YTMDesktopPlus/${ctx.app.version} (https://github.com/RealWhyKnot/YTMDesktopPlus)` },
          signal: AbortSignal.timeout(LRCLIB_TIMEOUT_MS)
        });
        if (!response.ok) throw new Error(`lrclib returned ${response.status}`);
        const picked = pickLrclib((await response.json()) as LrclibRecord[], target);
        if (picked) return { ...picked, source: "Source: LRCLIB" };
      }
      return null;
    };

    const resolve = async (video: VideoDetails): Promise<Lyrics | null> => {
      if (cache.has(video.id)) return cache.get(video.id) ?? null;

      let found: Lyrics | null = null;
      try {
        found = await fromYtm(video.id);
      } catch (error) {
        ctx.log.warn("Synced lyrics: YouTube Music lookup failed", error);
      }

      if (!found?.timed) {
        for (const otherId of counterpartIds(ctx.player.getQueue(), video)) {
          try {
            const other = await fromYtm(otherId);
            if (other?.timed) {
              found = other;
              break;
            }
          } catch (error) {
            ctx.log.warn("Synced lyrics: counterpart lookup failed", error);
          }
        }
      }

      if (!found?.timed && ctx.settings.get<boolean>("lrclib") !== false && !video.isLive) {
        try {
          found = (await fromLrclib(video, found)) ?? found;
        } catch (error) {
          ctx.log.info("Synced lyrics: LRCLIB lookup failed", error);
        }
      }

      remember(video.id, found);
      return found;
    };

    const show = async (video: VideoDetails | null) => {
      const mine = ++generation;
      if (!video) return;
      if (!cache.has(video.id)) await push({ videoId: video.id, pending: true, lines: null });
      const lyrics = await resolve(video);
      if (disposed || mine !== generation) return;
      await push(lyrics ? { videoId: video.id, lines: lyrics.lines, timed: lyrics.timed, source: lyrics.source || null } : { videoId: video.id, lines: null });
    };

    const css = ctx.ytmview.insertCSS(lyricsCss(ctx.settings.get<number>("textSize")));
    const unsubscribeTrack = ctx.player.on("trackChanged", ({ current }) => void show(current));
    const unsubscribeLoaded = ctx.ytmview.onLoaded(() => void show(ctx.player.getState().videoDetails));
    const unsubscribeSize = ctx.settings.onDidChange("textSize", next => void css.update(lyricsCss(Number(next))));
    const unsubscribeLrclib = ctx.settings.onDidChange("lrclib", () => {
      cache.clear();
      void show(ctx.player.getState().videoDetails);
    });
    void show(ctx.player.getState().videoDetails);

    return {
      destroy() {
        disposed = true;
        unsubscribeTrack();
        unsubscribeLoaded();
        unsubscribeSize();
        unsubscribeLrclib();
        void css.remove();
        void push({ disable: true });
      }
    };
  }
};

export default lyricsAddon;
