import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { appWindowPermissionAllowed, createSenderGuards, type SenderEvent } from "../src/main/ipc/sender-guards";
import {
  createPayloadRejectLog,
  isAlbumPayload,
  isFiniteNumber,
  isQueuePayload,
  isStoreStatePayload,
  isVideoDetailsPayload
} from "../src/main/ipc/ytm-view-payloads";
import { YTM_ORIGIN, YTM_SIGN_IN_ORIGINS } from "../src/main/ytm-navigation";

const contents = () => ({}) as WebContents;

function guardsFor(view: { webContents: WebContents }) {
  return createSenderGuards({
    getMainWindow: () => null,
    getSettingsWindow: () => null,
    getYtmView: () => view,
    ownsAddonContents: () => false
  });
}

const mainFrame = (url: string) => ({ url, parent: null as unknown });
const childFrame = (url: string) => ({ url, parent: mainFrame("https://music.youtube.com/") });

describe("isYtmViewPage", () => {
  const view = { webContents: contents() };
  const { isYtmViewPage } = guardsFor(view);
  const event = (senderFrame: SenderEvent["senderFrame"], sender = view.webContents): SenderEvent => ({ sender, senderFrame });

  it("accepts the YouTube Music main frame", () => {
    expect(isYtmViewPage(event(mainFrame("https://music.youtube.com/watch?v=1")))).toBe(true);
  });

  it("refuses sign-in and consent pages unless the channel allows them", () => {
    const loadedOrigins = [YTM_ORIGIN, ...YTM_SIGN_IN_ORIGINS];
    for (const url of ["https://consent.youtube.com/m", "https://accounts.google.com/ServiceLogin"]) {
      expect(isYtmViewPage(event(mainFrame(url))), url).toBe(false);
      expect(isYtmViewPage(event(mainFrame(url)), loadedOrigins), url).toBe(true);
    }
    expect(isYtmViewPage(event(mainFrame("https://accounts.youtube.com/")), loadedOrigins)).toBe(false);
  });

  it("refuses subframes, even at the YouTube Music origin", () => {
    expect(isYtmViewPage(event(childFrame("https://music.youtube.com/")))).toBe(false);
    expect(isYtmViewPage(event(childFrame("https://evil.com/")))).toBe(false);
  });

  it("refuses other origins in the main frame", () => {
    for (const url of ["https://evil.com/", "https://music.youtube.com.evil.com/", "http://music.youtube.com/", "about:blank", ""]) {
      expect(isYtmViewPage(event(mainFrame(url))), url).toBe(false);
    }
  });

  it("refuses a missing or disposed frame", () => {
    expect(isYtmViewPage(event(null))).toBe(false);
    expect(isYtmViewPage(event(undefined))).toBe(false);
    const disposed = {
      parent: null as unknown,
      get url(): string {
        throw new Error("Render frame was disposed before WebFrameMain could be accessed");
      }
    };
    expect(isYtmViewPage(event(disposed))).toBe(false);
  });

  it("refuses the right page in some other webContents", () => {
    expect(isYtmViewPage(event(mainFrame("https://music.youtube.com/"), contents()))).toBe(false);
  });
});

describe("appWindowPermissionAllowed", () => {
  const settings = contents();
  const addon = contents();
  const main = contents();
  const deps = { isSettingsSender: (sender: WebContents) => sender === settings, ownsAddonContents: (sender: WebContents) => sender === addon };

  it("lets settings and addon windows write to the clipboard", () => {
    expect(appWindowPermissionAllowed(deps, settings, "clipboard-sanitized-write")).toBe(true);
    expect(appWindowPermissionAllowed(deps, addon, "clipboard-sanitized-write")).toBe(true);
  });

  it("denies everything else", () => {
    expect(appWindowPermissionAllowed(deps, main, "clipboard-sanitized-write")).toBe(false);
    expect(appWindowPermissionAllowed(deps, null, "clipboard-sanitized-write")).toBe(false);
    for (const permission of ["media", "clipboard-read", "notifications", "openExternal", "fullscreen", "geolocation", "display-capture", "unknown"]) {
      expect(appWindowPermissionAllowed(deps, settings, permission), permission).toBe(false);
      expect(appWindowPermissionAllowed(deps, addon, permission), permission).toBe(false);
    }
  });
});

const realVideoDetails = {
  videoId: "dQw4w9WgXcQ",
  title: "Song",
  author: "Artist",
  channelId: "UC1",
  lengthSeconds: "213",
  isLive: false,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: { thumbnails: [{ url: "https://lh3.googleusercontent.com/x", width: 60, height: 60 }] }
};

describe("ytmView payload checks", () => {
  it("accepts what the page scripts send", () => {
    expect(isVideoDetailsPayload(realVideoDetails)).toBe(true);
    expect(isVideoDetailsPayload({ videoId: "abc" })).toBe(true);
    expect(isVideoDetailsPayload({ ...realVideoDetails, thumbnail: undefined })).toBe(true);
    expect(isAlbumPayload({ id: "MPREb_1", text: "Album" })).toBe(true);
    expect(isAlbumPayload(null)).toBe(true);
    expect(isAlbumPayload(undefined)).toBe(true);
    expect(isQueuePayload(null)).toBe(true);
    expect(
      isQueuePayload({
        items: [{ videoId: "a", title: "t", counterparts: null }, null, { videoId: "b", counterparts: [{ videoId: "c" }] }],
        automixItems: [],
        autoplay: true,
        isGenerating: false,
        isInfinite: false,
        repeatMode: "NONE"
      })
    ).toBe(true);
    expect(isStoreStatePayload("LIKE", 50, false, false)).toBe(true);
    expect(isStoreStatePayload("UNKNOWN", undefined, undefined, undefined)).toBe(true);
    expect(isFiniteNumber(12.5)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
  });

  it("rejects payloads that would throw in the player state store", () => {
    for (const value of [null, undefined, "x", 1, [], {}, { videoId: 1 }, { ...realVideoDetails, title: { toString: 1 } }]) {
      expect(isVideoDetailsPayload(value), JSON.stringify(value)).toBe(false);
    }
    expect(isVideoDetailsPayload({ ...realVideoDetails, thumbnail: { thumbnails: "x" } })).toBe(false);
    expect(isVideoDetailsPayload({ ...realVideoDetails, thumbnail: { thumbnails: [null] } })).toBe(false);
    expect(isVideoDetailsPayload({ ...realVideoDetails, thumbnail: { thumbnails: [{ url: 5 }] } })).toBe(false);
    expect(isVideoDetailsPayload({ ...realVideoDetails, thumbnail: "x" })).toBe(false);
    expect(isAlbumPayload("Album")).toBe(false);
    expect(isAlbumPayload({ id: 5 })).toBe(false);
    for (const value of [undefined, 1, "x", {}, { items: "x", automixItems: [] }, { items: [], automixItems: null }, { items: [1], automixItems: [] }]) {
      expect(isQueuePayload(value), JSON.stringify(value)).toBe(false);
    }
    expect(isQueuePayload({ items: [{ counterparts: "x" }], automixItems: [] })).toBe(false);
    expect(isQueuePayload({ items: [{ counterparts: [null] }], automixItems: [] })).toBe(false);
    expect(isStoreStatePayload(1, 50, false, false)).toBe(false);
    expect(isStoreStatePayload("LIKE", "50", false, false)).toBe(false);
    expect(isStoreStatePayload("LIKE", 50, "no", false)).toBe(false);
    for (const value of [NaN, Infinity, "1", null, undefined, {}]) {
      expect(isFiniteNumber(value), String(value)).toBe(false);
    }
  });

  it("logs a dropped payload once per channel", () => {
    const warn = vi.fn();
    const reject = createPayloadRejectLog(warn);
    reject("ytmView:videoDataChanged");
    reject("ytmView:videoDataChanged");
    reject("ytmView:queueChanged");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("Dropped a malformed ytmView:videoDataChanged message from the YTM view");
  });
});
