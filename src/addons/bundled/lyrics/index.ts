import lyricsStyles from "./lyrics.css?raw";
import lyricsHostStyles from "./lyrics.user.css?raw";
import type { BundledAddonDefinition } from "../../../main/addons/managed-addon";
import type { PlayerQueue, VideoDetails } from "../../../shared/addons/sdk";
import { cleanArtist, cleanTitle, fromYtmTimed, pickLrclib, type Lyrics, DURATION_TOLERANCE_SECONDS } from "./lyrics-data";
import { isRecord } from "~shared/unknown";

import fetchScript from "./scripts/fetch.script?raw";
import lyricsScript from "./scripts/lyrics.script?raw";

export const TEXT_SIZES = [
  { label: "Small", value: 18 },
  { label: "Medium", value: 22 },
  { label: "Large", value: 26 },
];

export const DEFAULT_TEXT_SIZE = 18;

export const LRCLIB_URL = "https://lrclib.net/api/search";
const LRCLIB_TIMEOUT_MS = 8000;
const CACHE_LIMIT = 50;

export function lyricsCss(size: unknown): string {
  const px = typeof size === "number" && TEXT_SIZES.some((option) => option.value === size) ? size : DEFAULT_TEXT_SIZE;
  return `${lyricsHostStyles}\n${lyricsStyles}\n:root { --ytmd-lyrics-font-size: ${px / 10}rem; }`;
}

export function durationFromText(text: unknown): number | null {
  const duration: unknown = text ?? "";
  const parts = String(duration).trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function counterpartIds(queue: PlayerQueue | null, video: VideoDetails): string[] {
  const items = [...(queue?.items ?? []), ...(queue?.automixItems ?? [])];
  const selected = items.find((item) => item?.videoId === video.id) ?? items.find((item) => item?.counterparts?.some((other) => other.videoId === video.id));
  if (!selected) return [];
  const renditions = [selected, ...(selected.counterparts ?? [])];
  return renditions
    .filter((item) => item.videoId !== video.id)
    .filter((item) => {
      const seconds = durationFromText(item.duration);
      return seconds !== null && Math.abs(seconds - video.durationSeconds) <= DURATION_TOLERANCE_SECONDS;
    })
    .map((item) => item.videoId);
}

type PagePayload = { videoId: string; pending?: boolean; lines: Lyrics["lines"] | null; timed?: boolean; source?: string | null };

const lyricsAddon = {
  manifest: {
    id: "lyrics",
    name: "Synced lyrics",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Shows the Lyrics tab in large type and highlights each line as it's sung. Click a line to jump to it.",
    defaultEnabled: true,
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
            options: TEXT_SIZES,
          },
          {
            key: "lrclib",
            type: "toggle",
            label: "Look up missing timings on LRCLIB",
            description:
              "If YouTube Music has no synced lyrics for a song, look for them on lrclib.net. This sends the song's title, artist and length to lrclib.net.",
          },
        ],
      },
    ]);

    ctx.ytmview.registerScript("fetch", fetchScript);
    ctx.ytmview.registerScript("render", lyricsScript);

    const cache = new Map<string, Lyrics | null>();
    let generation = 0;
    let isDisposed = false;

    const remember = (videoId: string, lyrics: Lyrics | null) => {
      cache.delete(videoId);
      cache.set(videoId, lyrics);
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    };

    const push = async (payload: PagePayload | { disable: true }) => {
      try {
        await ctx.ytmview.invokeScript("render", payload);
      } catch (error) {
        ctx.log.warn("Synced lyrics could not reach the page", error);
      }
    };

    const fromYtm = async (videoId: string): Promise<Lyrics | null> => {
      const result = await ctx.ytmview.invokeScript("fetch", { videoId });
      if (!isRecord(result)) return null;
      const lyrics = fromYtmTimed(result.lines);
      if (!lyrics || lyrics.lines.every((line) => !line.text)) return null;
      return { ...lyrics, source: typeof result.source === "string" ? result.source : "" };
    };

    const fromLrclib = async (video: VideoDetails, reference: Lyrics | null): Promise<Lyrics | null> => {
      if (video.author === "") return null;
      const title = cleanTitle(video.title);
      const artist = cleanArtist(video.author);
      if (!title) return null;
      const target = {
        durationSeconds: video.durationSeconds,
        referenceText: reference ? reference.lines.map((line) => line.text).join("\n") : null,
      };
      const queries = [new URLSearchParams({ track_name: title, artist_name: artist }), new URLSearchParams({ q: `${title} ${artist}`.trim() })];
      for (const query of queries) {
        const response = await fetch(`${LRCLIB_URL}?${query}`, {
          headers: { "User-Agent": `YTMDesktopPlus/${ctx.app.version} (https://github.com/RealWhyKnot/YTMDesktopPlus)` },
          signal: AbortSignal.timeout(LRCLIB_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`lrclib returned ${response.status}`);
        const records: unknown = await response.json();
        const picked = pickLrclib(records, target);
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

      if (!found?.timed && ctx.settings.get("lrclib") && !video.isLive) {
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
      if (isDisposed || mine !== generation) return;
      await push(lyrics ? { videoId: video.id, lines: lyrics.lines, timed: lyrics.timed, source: lyrics.source || null } : { videoId: video.id, lines: null });
    };

    const css = ctx.ytmview.insertCSS(lyricsCss(ctx.settings.get("textSize")));
    const unsubscribeTrack = ctx.player.on(
      "trackChanged",
      ({ current }) => void show(current).catch((error: unknown) => console.warn("activate failed", error))
    );
    const unsubscribeLoaded = ctx.ytmview.onLoaded(
      () => void show(ctx.player.getState().videoDetails).catch((error: unknown) => console.warn("activate failed", error))
    );
    const unsubscribeSize = ctx.settings.onDidChange(
      "textSize",
      (next) => void css.update(lyricsCss(Number(next))).catch((error: unknown) => console.warn("activate failed", error))
    );
    const unsubscribeLrclib = ctx.settings.onDidChange("lrclib", () => {
      cache.clear();
      void show(ctx.player.getState().videoDetails).catch((error: unknown) => console.warn("activate failed", error));
    });
    void show(ctx.player.getState().videoDetails).catch((error: unknown) => console.warn("activate failed", error));

    return {
      destroy() {
        isDisposed = true;
        unsubscribeTrack();
        unsubscribeLoaded();
        unsubscribeSize();
        unsubscribeLrclib();
        void css.remove().catch((error: unknown) => console.warn("destroy failed", error));
        void push({ disable: true }).catch((error: unknown) => console.warn("destroy failed", error));
      },
    };
  },
} satisfies BundledAddonDefinition;

export { lyricsAddon };
