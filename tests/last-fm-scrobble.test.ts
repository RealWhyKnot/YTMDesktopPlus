import { describe, expect, it } from "vitest";
import LastFM from "../src/main/integrations/last-fm";
import { VideoState, type PlayerState } from "../src/main/player-state-store";
import type { PlayerQueue, PlayerQueueItem } from "~shared/addons/sdk";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

type Internals = {
  isEnabled: boolean;
  possibleVideoIds: string[] | null;
  getSession(): void;
  updatePlayerState(state: PlayerState): Promise<void>;
};

function enabledInstance() {
  const instance = new LastFM() as unknown as Internals;
  instance.isEnabled = true;
  instance.getSession = () => {};
  return instance;
}

function queueItem(overrides: Partial<PlayerQueueItem> = {}): PlayerQueueItem {
  return {
    thumbnails: [],
    title: "Track",
    author: "Artist",
    duration: "3:00",
    selected: true,
    videoId: "vid",
    counterparts: null,
    ...overrides
  };
}

function queue(overrides: Partial<PlayerQueue> = {}): PlayerQueue {
  return {
    automixItems: [],
    autoplay: false,
    isGenerating: false,
    isInfinite: false,
    items: [queueItem()],
    repeatMode: 0 as PlayerQueue["repeatMode"],
    selectedItemIndex: 0,
    ...overrides
  };
}

const playing = (overrides: Partial<PlayerState> = {}) =>
  makePlayerState({ videoDetails: makeVideoDetails({ id: "vid" }), trackState: VideoState.Playing, ...overrides });

describe("updatePlayerState with an absent queue", () => {
  it("does not throw when the queue is null", async () => {
    const instance = enabledInstance();
    await expect(instance.updatePlayerState(playing({ queue: null }))).resolves.toBeUndefined();
  });

  it("falls back to the playing video id so the track can still be recognised", async () => {
    const instance = enabledInstance();
    await instance.updatePlayerState(playing({ queue: null }));
    expect(instance.possibleVideoIds).toEqual(["vid"]);
  });

  it("does not throw when the selected index is out of range", async () => {
    const instance = enabledInstance();
    await expect(instance.updatePlayerState(playing({ queue: queue({ selectedItemIndex: 7 }) }))).resolves.toBeUndefined();
    expect(instance.possibleVideoIds).toEqual(["vid"]);
  });
});

describe("updatePlayerState with a queue", () => {
  it("collects counterpart ids alongside the selected item", async () => {
    const instance = enabledInstance();
    const selected = queueItem({ videoId: "audio", counterparts: [queueItem({ videoId: "video" })] });
    await instance.updatePlayerState(playing({ queue: queue({ items: [selected] }) }));
    expect(instance.possibleVideoIds).toEqual(["video", "audio"]);
  });
});
