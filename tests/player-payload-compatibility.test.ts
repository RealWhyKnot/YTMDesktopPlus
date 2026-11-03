import { describe, expect, it } from "vitest";
import { isAlbumPayload, isQueuePayload, isVideoDetailsPayload } from "../src/main/ipc/ytm-view-payloads";
import { playerStateStore } from "../src/main/player-state-store";

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

  it("retains partial queue entries and absent queue flags", () => {
    const queue = { items: [{ selected: "yes" }], automixItems: [] };
    expect(isQueuePayload(queue)).toBe(true);
    Reflect.apply(playerStateStore.updateQueue.bind(playerStateStore), undefined, [queue]);
    expect(playerStateStore.getQueue()?.items).toBe(queue.items);
    expect(playerStateStore.getQueue()?.autoplay).toBeUndefined();
    expect(playerStateStore.getQueue()?.selectedItemIndex).toBe(0);
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
