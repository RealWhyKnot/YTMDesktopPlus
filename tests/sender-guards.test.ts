import type { WebContents } from "electron";
import { describe, expect, it } from "vitest";
import { createSenderGuards } from "../src/main/ipc/sender-guards";

const contents = () => ({}) as WebContents;

describe("sender guards", () => {
  it("matches the YTM view's own contents and nothing else", () => {
    const view = { webContents: contents() };
    const { isYtmViewSender } = createSenderGuards({
      getMainWindow: () => null,
      getSettingsWindow: () => null,
      getYtmView: () => view,
      ownsAddonContents: () => false
    });
    expect(isYtmViewSender(view.webContents)).toBe(true);
    expect(isYtmViewSender(contents())).toBe(false);
  });

  it("answers false instead of throwing once the YTM view is gone", () => {
    const { isYtmViewSender, isMainWindowSender } = createSenderGuards({
      getMainWindow: () => null,
      getSettingsWindow: () => null,
      getYtmView: () => null,
      ownsAddonContents: () => false
    });
    expect(() => isYtmViewSender(contents())).not.toThrow();
    expect(isYtmViewSender(contents())).toBe(false);
    expect(isMainWindowSender(contents())).toBe(false);
  });
});
