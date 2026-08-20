import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createStoreBroadcaster, type BroadcastTargets } from "../src/main/windows/broadcast";

const liveContents = () => {
  const send = vi.fn();
  return { contents: { isDestroyed: () => false, send } as unknown as WebContents, send };
};

const destroyedContents = () => {
  const send = vi.fn();
  return { contents: { isDestroyed: () => true, send } as unknown as WebContents, send };
};

const targets = (overrides: Partial<BroadcastTargets>): BroadcastTargets => ({
  getMainWindow: () => null,
  getSettingsWindow: () => null,
  getYtmView: () => null,
  addonWebContents: () => [],
  ...overrides
});

describe("createStoreBroadcaster", () => {
  it("sends to live targets and respects includeMainWindow", () => {
    const main = liveContents();
    const ytm = liveContents();
    const broadcast = createStoreBroadcaster(
      targets({
        getMainWindow: () => ({ webContents: main.contents }),
        getYtmView: () => ({ webContents: ytm.contents })
      })
    );

    broadcast("channel", { includeMainWindow: false }, "a");
    expect(main.send).not.toHaveBeenCalled();
    expect(ytm.send).toHaveBeenCalledWith("channel", "a");

    broadcast("channel", { includeMainWindow: true }, "b");
    expect(main.send).toHaveBeenCalledWith("channel", "b");
  });

  it("skips a stale view whose webContents is gone", () => {
    // A BrowserView's webContents getter returns undefined after the owning
    // window is destroyed; the holder object itself stays non-null.
    const broadcast = createStoreBroadcaster(
      targets({
        getYtmView: () => ({ webContents: undefined as unknown as WebContents })
      })
    );

    expect(() => broadcast("channel", { includeMainWindow: true })).not.toThrow();
  });

  it("skips destroyed webContents", () => {
    const settings = destroyedContents();
    const broadcast = createStoreBroadcaster(
      targets({
        getSettingsWindow: () => ({ webContents: settings.contents })
      })
    );

    broadcast("channel", { includeMainWindow: false });
    expect(settings.send).not.toHaveBeenCalled();
  });

  it("skips destroyed addon webContents but sends to live ones", () => {
    const dead = destroyedContents();
    const live = liveContents();
    const broadcast = createStoreBroadcaster(
      targets({
        addonWebContents: () => [dead.contents, live.contents]
      })
    );

    broadcast("channel", { includeMainWindow: false }, 1, 2);
    expect(dead.send).not.toHaveBeenCalled();
    expect(live.send).toHaveBeenCalledWith("channel", 1, 2);
  });
});
