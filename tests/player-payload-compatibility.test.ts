import { afterEach, describe, expect, it, vi } from "vitest";
import { isAlbumPayload, isQueuePayload, isVideoDetailsPayload } from "../src/main/ipc/ytm-view-payloads";
import { playerStateStore, RepeatMode } from "../src/main/player-state-store";
import { installQueueProjection } from "../src/shared/queue-projection";
import { requireValue } from "./helpers/require-value";

function projectQueue(queue: unknown): unknown {
  const page: { __ytmdProjectQueue?: (queue: unknown) => unknown } = {};
  vi.stubGlobal("window", page);
  installQueueProjection();
  return requireValue(page.__ytmdProjectQueue)(queue);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("player payload compatibility", () => {
  it("normalizes partial metadata accepted by IPC", () => {
    const video = { videoId: "id" };
    expect(isVideoDetailsPayload(video)).toBe(true);
    playerStateStore.updateVideoDetails(video, undefined, null, undefined, false);
    expect(playerStateStore.getState().videoDetails).toMatchObject({ author: "", title: "", channelId: "", thumbnails: [] });
    expect(playerStateStore.getState().hasFullMetadata).toBe(false);
  });

  it.each([{}, { id: null, text: null }, { id: undefined, text: undefined }, null, undefined])("keeps absent album values as null for %j", (album) => {
    expect(isAlbumPayload(album)).toBe(true);
    playerStateStore.updateVideoDetails({ videoId: "id" }, undefined, album ?? null, undefined, true);
    expect(playerStateStore.getState().videoDetails?.album).toBeNull();
    expect(playerStateStore.getState().videoDetails?.albumId).toBeNull();
  });

  it("retains the projection's defaults for partial renderers and missing queue flags", () => {
    const queue = projectQueue({ items: [{}, { playlistPanelVideoRenderer: { selected: true } }] });
    if (!isQueuePayload(queue)) throw new Error("The projected queue was rejected");
    playerStateStore.updateQueue(queue);
    expect(playerStateStore.getQueue()).toEqual({
      items: [null, { title: "", author: "", duration: "", selected: true, videoId: "", thumbnails: [], counterparts: null }],
      automixItems: [],
      autoplay: false,
      isGenerating: false,
      isInfinite: false,
      repeatMode: RepeatMode.Unknown,
      selectedItemIndex: 1,
    });
  });

  it.each([undefined, null, "60", NaN, Infinity, -Infinity])("filters queue thumbnail dimensions %s after accepting the projection", (dimension) => {
    const thumbnails = [
      { url: "missing-both" },
      { url: "bad-width", width: dimension, height: 60 },
      { url: "bad-height", width: 60, height: dimension },
      { url: "finite", width: 60, height: 90 },
      { url: "zero", width: 0, height: 0 },
    ];
    const renderer = {
      videoId: "a",
      title: { runs: [{ text: "Song" }] },
      shortBylineText: { runs: [{ text: "Artist" }] },
      lengthText: { runs: [{ text: "3:21" }] },
      selected: true,
      thumbnail: { thumbnails },
    };
    const entry = {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: { playlistPanelVideoRenderer: renderer },
        counterpart: [{ counterpartRenderer: { playlistPanelVideoRenderer: { ...renderer, videoId: "b", selected: false } } }],
      },
    };
    const queue = projectQueue({ items: [{}, entry], automixItems: [entry], autoplay: true, isInfinite: true, repeatMode: "ALL" });
    if (!isQueuePayload(queue)) throw new Error("The projected queue was rejected");
    const original = structuredClone(queue);
    playerStateStore.updateQueue(queue);
    const expected = {
      title: "Song",
      author: "Artist",
      duration: "3:21",
      selected: true,
      videoId: "a",
      thumbnails: [
        { url: "finite", width: 60, height: 90 },
        { url: "zero", width: 0, height: 0 },
      ],
      counterparts: null,
    };
    const item = { ...expected, counterparts: [{ ...expected, videoId: "b", selected: false }] };
    expect(playerStateStore.getQueue()).toEqual({
      items: [null, item],
      automixItems: [item],
      autoplay: true,
      isGenerating: false,
      isInfinite: true,
      repeatMode: RepeatMode.All,
      selectedItemIndex: 1,
    });
    expect(queue).toEqual(original);
  });

  it.each([undefined, null, "60", NaN, Infinity, -Infinity])("omits thumbnails with nonfinite dimensions %s", (dimension) => {
    const video = {
      videoId: "id",
      title: null,
      author: null,
      channelId: null,
      thumbnail: {
        thumbnails: [
          { url: "bad-width", width: dimension, height: 60 },
          { url: "bad-height", width: 60, height: dimension },
          { url: "finite", width: 60, height: 90 },
          { url: "zero", width: 0, height: 0 },
        ],
      },
    };
    expect(isVideoDetailsPayload(video)).toBe(true);
    playerStateStore.updateVideoDetails(video, undefined, null, undefined, false);
    expect(playerStateStore.getState().videoDetails).toMatchObject({
      author: "",
      title: "",
      channelId: "",
      thumbnails: [
        { url: "finite", width: 60, height: 90 },
        { url: "zero", width: 0, height: 0 },
      ],
    });
  });
});
