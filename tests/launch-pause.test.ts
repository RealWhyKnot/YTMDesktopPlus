import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAUNCH_PAUSE_TIMEOUT_MS, createLaunchPause } from "../src/main/playback/launch-pause";
import { VideoState, type PlayerState } from "../src/main/player-state-store";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

function makeHarness() {
  const listeners = new Set<(state: PlayerState) => void>();
  const sent: string[] = [];
  const launchPause = createLaunchPause({
    addEventListener: listener => listeners.add(listener),
    removeEventListener: listener => listeners.delete(listener),
    send: command => sent.push(command)
  });
  const emit = (videoId: string, trackState: VideoState) => {
    const state = makePlayerState({ trackState, videoDetails: makeVideoDetails({ id: videoId }) });
    for (const listener of [...listeners]) listener(state);
  };
  return { launchPause, emit, sent, listeners };
}

describe("createLaunchPause", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pauses when the armed track reports playing, then restores mute", async () => {
    const { launchPause, emit, sent } = makeHarness();
    const result = launchPause.arm("abc", false);
    emit("other", VideoState.Playing);
    expect(sent).toEqual([]);
    emit("abc", VideoState.Buffering);
    expect(sent).toEqual([]);
    emit("abc", VideoState.Playing);
    expect(sent).toEqual(["pause", "unmute"]);
    await expect(result).resolves.toBe("paused");
  });

  it("keeps the player muted when the user had muted it themselves", async () => {
    const { launchPause, emit, sent } = makeHarness();
    const result = launchPause.arm("abc", true);
    emit("abc", VideoState.Playing);
    expect(sent).toEqual(["pause"]);
    await expect(result).resolves.toBe("paused");
  });

  it("restores mute and gives up on timeout without pausing", async () => {
    const { launchPause, sent, listeners } = makeHarness();
    const result = launchPause.arm("abc", false);
    vi.advanceTimersByTime(LAUNCH_PAUSE_TIMEOUT_MS);
    expect(sent).toEqual(["unmute"]);
    await expect(result).resolves.toBe("timeout");
    expect(listeners.size).toBe(0);
  });

  it("supersedes an armed attempt without touching its mute state", async () => {
    const { launchPause, emit, sent } = makeHarness();
    const first = launchPause.arm("abc", false);
    const second = launchPause.arm("def", false);
    await expect(first).resolves.toBe("superseded");
    expect(sent).toEqual([]);
    emit("def", VideoState.Playing);
    expect(sent).toEqual(["pause", "unmute"]);
    await expect(second).resolves.toBe("paused");
  });

  it("only reacts once per arm", async () => {
    const { launchPause, emit, sent } = makeHarness();
    const result = launchPause.arm("abc", false);
    emit("abc", VideoState.Playing);
    emit("abc", VideoState.Playing);
    expect(sent).toEqual(["pause", "unmute"]);
    await expect(result).resolves.toBe("paused");
  });

  it("cancel settles the pending attempt as superseded", async () => {
    const { launchPause, sent, listeners } = makeHarness();
    const result = launchPause.arm("abc", false);
    launchPause.cancel();
    await expect(result).resolves.toBe("superseded");
    expect(sent).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});
