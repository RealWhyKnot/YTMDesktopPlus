import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddonInstance } from "../src/shared/addons/sdk";
import mobileBridgeAddon from "../src/addons/bundled/mobile-bridge";
import { VideoState } from "../src/main/player-state-store";
import { fakeAddonContext, makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

const phoneTrack = {
  videoId: "phone1",
  title: "Phone Song",
  author: "Phone Artist",
  thumbnailUrl: "https://example.invalid/a.jpg",
  durationSeconds: null as number | null
};

// The raw browse-response shape extractHistoryHead reads back into rows.
function browseResponse(tracks: (typeof phoneTrack)[]) {
  return {
    contents: tracks.map(track => ({
      musicResponsiveListItemRenderer: {
        playlistItemData: { videoId: track.videoId },
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: track.title }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: track.author }] } } }
        ],
        thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: track.thumbnailUrl }] } } }
      }
    }))
  };
}

function fakeContext(overrides: { settings?: Record<string, unknown>; history?: (typeof phoneTrack)[] } = {}) {
  return fakeAddonContext({
    manifest: mobileBridgeAddon.manifest,
    settings: { discordMirrorEnabled: true, ...overrides.settings },
    innertube: endpoint => (endpoint === "browse" ? Promise.resolve(browseResponse(overrides.history ?? [])) : Promise.resolve({}))
  });
}

describe("mobile-bridge bundled addon", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("declares the expected manifest", () => {
    expect(mobileBridgeAddon.manifest.id).toBe("mobile-bridge");
    expect(mobileBridgeAddon.manifest.defaultEnabled).toBe(false);
  });

  it("registers defaults, scripts, css and the presence provider on activate", async () => {
    vi.useFakeTimers();
    const { ctx } = fakeContext();
    const instance = (await mobileBridgeAddon.activate(ctx)) as AddonInstance | undefined;

    expect(ctx.settings.registerDefaults).toHaveBeenCalledWith({ discordMirrorEnabled: true });
    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("banner", expect.any(String));
    expect(ctx.ytmview.insertCSS).toHaveBeenCalledTimes(1);
    expect(ctx.discord.registerRemoteActivityProvider).toHaveBeenCalledTimes(1);
    await instance?.destroy?.();
  });

  it("mirrors a phone track to banner, badge and presence, and local playback clears it", async () => {
    vi.useFakeTimers();
    const { ctx, captured, fireLoaded, emitPlayerState } = fakeContext({ history: [phoneTrack] });
    const instance = (await mobileBridgeAddon.activate(ctx)) as AddonInstance | undefined;

    fireLoaded();
    await vi.advanceTimersByTimeAsync(50);

    const shows = captured.invocations.filter(call => call.name === "banner");
    expect(shows.at(-1)?.arg).toEqual({ action: "show", track: phoneTrack });
    expect(captured.badges.at(-1)).toMatchObject({ icon: "smartphone", active: true });
    expect(captured.remoteProviders[0]?.()).toMatchObject({ title: "Phone Song", author: "Phone Artist", smallText: "Playing on your phone" });
    expect(ctx.discord.refreshActivity).toHaveBeenCalled();

    emitPlayerState(makePlayerState({ trackState: VideoState.Playing, videoDetails: makeVideoDetails({ id: "localvid" }), hasFullMetadata: true }));
    expect(captured.invocations.filter(call => call.name === "banner").at(-1)?.arg).toEqual({ action: "hide" });
    expect(captured.badges.at(-1)).toBeNull();
    expect(captured.remoteProviders[0]?.()).toBeUndefined();
    await instance?.destroy?.();
  });

  it("keeps the presence provider silent when the discord toggle is off", async () => {
    vi.useFakeTimers();
    const { ctx, captured, fireLoaded } = fakeContext({ history: [phoneTrack], settings: { discordMirrorEnabled: false } });
    const instance = (await mobileBridgeAddon.activate(ctx)) as AddonInstance | undefined;

    fireLoaded();
    await vi.advanceTimersByTimeAsync(50);

    expect(captured.invocations.filter(call => call.name === "banner").at(-1)?.arg).toEqual({ action: "show", track: phoneTrack });
    expect(captured.remoteProviders[0]?.()).toBeUndefined();
    await instance?.destroy?.();
  });

  it("clears every surface on destroy", async () => {
    vi.useFakeTimers();
    const { ctx, captured, fireLoaded } = fakeContext({ history: [phoneTrack] });
    const instance = (await mobileBridgeAddon.activate(ctx)) as AddonInstance | undefined;
    fireLoaded();
    await vi.advanceTimersByTimeAsync(50);

    await instance?.destroy?.();
    expect(captured.invocations.filter(call => call.name === "banner").at(-1)?.arg).toEqual({ action: "hide" });
    expect(captured.badges.at(-1)).toBeNull();
  });
});
