import { afterEach, describe, expect, it, vi } from "vitest";
import { LastFM } from "../src/main/integrations/last-fm";
import { callMethod } from "./helpers/call-method";
import { makeVideoDetails } from "./helpers/fake-addon-context";
import { partialPlayerState } from "./helpers/partial-player-state";
import { requireValue } from "./helpers/require-value";

function instance() {
  const lastfm = new LastFM();
  Reflect.set(lastfm, "lastfmDetails", { api_key: "key", secret: "secret", sessionKey: "session", token: null, scrobblePercent: 50 });
  Reflect.set(lastfm, "isEnabled", true);
  return lastfm;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Last.fm incomplete metadata", () => {
  it.each(["track.scrobble", "track.updateNowPlaying"])("classifies missing-artist error 6 as fatal for %s", async (method) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 6, message: "Missing artist" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const lastfm = instance();
    const result = await callMethod(lastfm, "callApi", { method, artist: undefined, track: "Song" }, "POST");
    expect(result).toEqual({ ok: false, kind: "fatal", code: 6, message: "Missing artist" });
    callMethod(lastfm, "handleTrackResult", result, method === "track.scrobble" ? { videoDetails: makeVideoDetails(), timestamp: 123 } : null);
    expect(Reflect.get(lastfm, "pendingScrobbles")).toEqual([]);
    expect(Reflect.get(lastfm, "backoffUntil")).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{ videoId: "id", title: "Song" }, { videoId: "id", author: "Artist" }, { videoId: "id" }])(
    "skips incomplete metadata %j without queuing it",
    async (payload) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
      const fetchMock = vi.fn(() => Promise.reject(new Error("Unexpected request")));
      vi.stubGlobal("fetch", fetchMock);
      const lastfm = instance();
      const video = requireValue(partialPlayerState(payload).videoDetails);
      await callMethod(lastfm, "updateNowPlaying", video);
      await callMethod(lastfm, "scrobbleSong", video, Date.now());
      Reflect.set(lastfm, "lastfmDetails", { api_key: "key", secret: "secret", sessionKey: null, token: null, scrobblePercent: 50 });
      await callMethod(lastfm, "scrobbleSong", video, Date.now());
      expect(Reflect.get(lastfm, "pendingScrobbles")).toEqual([]);
      expect(Reflect.get(lastfm, "backoffUntil")).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("drops incomplete queued metadata and sends the valid entry behind it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ scrobbles: {} }) }));
    vi.stubGlobal("fetch", fetchMock);
    const lastfm = instance();
    Reflect.set(lastfm, "pendingScrobbles", [
      { videoDetails: requireValue(partialPlayerState({ videoId: "id", title: "Song" }).videoDetails), timestamp: 123 },
      { videoDetails: requireValue(partialPlayerState({ videoId: "id", author: "Artist" }).videoDetails), timestamp: 124 },
      { videoDetails: makeVideoDetails(), timestamp: 125 },
    ]);
    await callMethod(lastfm, "flushQueue");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Reflect.get(lastfm, "pendingScrobbles")).toEqual([]);
    expect(Reflect.get(lastfm, "backoffUntil")).toBe(0);
  });
});
