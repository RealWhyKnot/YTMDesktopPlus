import { afterEach, describe, expect, it, vi } from "vitest";

const shown = vi.hoisted(() => [] as Array<{ title: string; body: string }>);

vi.mock("electron", () => ({
  Notification: class {
    constructor(private options: { title: string; body: string }) {}
    show() {
      shown.push({ title: this.options.title, body: this.options.body });
    }
    close() {}
  },
  nativeImage: { createFromDataURL: () => ({}) }
}));

import NowPlayingNotifications from "../src/main/integrations/notifications";
import playerStateStore from "../src/main/player-state-store";
import { createLaunchPause } from "../src/main/playback/launch-pause";

const details = (videoId: string) => ({
  album: "",
  author: "Artist",
  channelId: "chan",
  lengthSeconds: "180",
  thumbnail: { thumbnails: [] as { url: string; width: number; height: number }[] },
  title: `Track ${videoId}`,
  videoId,
  isLive: false,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV"
});

describe("now playing notifications", () => {
  const notifications = new NowPlayingNotifications();

  afterEach(() => {
    notifications.disable();
    shown.length = 0;
    playerStateStore.updateVideoState(2);
  });

  it("stays quiet for the paused restore at launch", () => {
    const launchPause = createLaunchPause({ addEventListener: () => {}, removeEventListener: () => {}, send: () => {} });
    notifications.enable();

    void launchPause.arm("restored", true);
    playerStateStore.updateVideoDetails(details("restored"), "PL1", null, "INDIFFERENT", true);
    playerStateStore.updateVideoState(1);
    expect(shown).toEqual([]);

    launchPause.cancel();
    playerStateStore.updateVideoState(2);
    playerStateStore.updateVideoState(1);
    expect(shown).toEqual([{ title: "Track restored", body: "Artist" }]);
  });

  it("shows the next track as usual", () => {
    notifications.enable();

    playerStateStore.updateVideoDetails(details("next"), "PL1", null, "INDIFFERENT", true);
    playerStateStore.updateVideoState(1);
    expect(shown).toEqual([{ title: "Track next", body: "Artist" }]);
  });
});
