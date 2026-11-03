import { describe, expect, it, vi } from "vitest";
import { compareVersions } from "../src/shared/update-feed";
import { versionAtLeast } from "../src/main/addons/validate-manifest";
import { playerStateStore } from "../src/main/player-state-store";
import { executeRemoteCommand } from "../src/renderer/ytmview/remote-control";

const { invokePage } = vi.hoisted(() => ({ invokePage: vi.fn() }));
vi.mock("../src/renderer/ytmview/execute-page-script", () => ({ executePageScript: async () => await Promise.resolve(invokePage) }));

const inputs = [
  { raw: "", expected: NaN },
  { raw: "12px", expected: 12 },
  { raw: "1.5", expected: 1 },
  { raw: " 7 ", expected: 7 },
  { raw: "3beta", expected: 3 },
  { raw: "0x10", expected: 16 },
  { raw: "-0", expected: -0 },
  { raw: "\ufeff+12e3", expected: 12 },
  { raw: "Infinity", expected: NaN },
  { raw: "9".repeat(400), expected: Infinity },
];

describe("integer input compatibility", () => {
  it.each([...inputs, { raw: null, expected: NaN }, { raw: undefined, expected: NaN }])("keeps the player duration for '$raw'", ({ raw, expected }) => {
    playerStateStore.updateVideoDetails(
      {
        album: "",
        author: "Artist",
        channelId: "channel",
        lengthSeconds: raw,
        thumbnail: { thumbnails: [] },
        title: "Track",
        videoId: "id",
        isLive: false,
        musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
      },
      undefined,
      null,
      "INDIFFERENT",
      true
    );
    expect(playerStateStore.getState().videoDetails?.durationSeconds).toBe(expected);
  });

  it.each([...inputs, { raw: null, expected: NaN }, { raw: 1e-7, expected: 1 }, { raw: 1e21, expected: 1 }])(
    "keeps remote volume for '$raw'",
    async ({ raw, expected }) => {
      invokePage.mockClear();
      await executeRemoteCommand("setVolume", raw);
      if (Number.isFinite(expected) && expected >= 0 && expected <= 100) expect(invokePage).toHaveBeenCalledWith(expected);
      else expect(invokePage).not.toHaveBeenCalled();
    }
  );

  it.each([...inputs, { raw: null, expected: NaN }, { raw: 1e-7, expected: 1 }, { raw: 1e21, expected: 1 }])(
    "keeps remote queue index for '$raw'",
    async ({ raw, expected }) => {
      invokePage.mockClear();
      await executeRemoteCommand("playQueueIndex", raw);
      if (Number.isFinite(expected)) expect(invokePage).toHaveBeenCalledWith(expected);
      else expect(invokePage).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["", "0"],
    ["12px", "12"],
    ["1.5", "1.5"],
    [" 7 ", "7"],
    ["3beta", "3"],
    ["0x10", "0"],
    ["+12e3", "12"],
    ["Infinity", "0"],
  ])("keeps version component '%s' equivalent to '%s'", (raw, expected) => {
    expect(compareVersions(raw, expected)).toBe(0);
    expect(versionAtLeast(raw, expected)).toBe(true);
    expect(versionAtLeast(expected, raw)).toBe(true);
  });

  it("keeps the different overflow handling of feed and manifest versions", () => {
    const overflowing = "9".repeat(400);
    expect(compareVersions(overflowing, "0")).toBe(0);
    expect(versionAtLeast(overflowing, "1")).toBe(true);
    expect(versionAtLeast("1", overflowing)).toBe(false);
  });
});
