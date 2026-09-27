import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MessagePortMain } from "electron";
import { MediaHost, serveMediaScheme, type MediaHostWindow } from "../src/main/media/media-host";

function fakePort(name: string) {
  return { name, close: vi.fn() } as unknown as MessagePortMain & { name: string; close: ReturnType<typeof vi.fn> };
}

function fakeWindow() {
  const handlers = new Map<string, () => void>();
  const posted: { channel: string; ports: unknown[] }[] = [];
  let destroyed = false;
  const window: MediaHostWindow = {
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
    },
    webContents: {
      postMessage: (channel, _message, ports) => posted.push({ channel, ports: ports ?? [] }),
      once: (event, listener) => handlers.set(event, listener),
      on: (event, listener) => handlers.set(event, listener)
    }
  };
  return { window, posted, fire: (event: string) => handlers.get(event)?.(), isDestroyed: () => destroyed };
}

function host() {
  const windows: ReturnType<typeof fakeWindow>[] = [];
  const mediaHost = new MediaHost();
  mediaHost.provide(() => {
    const created = fakeWindow();
    windows.push(created);
    return created.window;
  });
  const consumer = { onPackets: vi.fn(), onStatus: vi.fn() };
  return { mediaHost, windows, consumer };
}

describe("media host", () => {
  it("opens one hidden window however often capture starts", () => {
    const { mediaHost, windows, consumer } = host();

    mediaHost.start(consumer);
    mediaHost.start(consumer);

    expect(windows).toHaveLength(1);
  });

  it("holds the page's audio channel until the window has loaded, then hands it over", () => {
    const { mediaHost, windows, consumer } = host();
    mediaHost.start(consumer);
    const port = fakePort("page");

    mediaHost.acceptPagePort(port);
    expect(windows[0].posted).toEqual([]);

    windows[0].fire("did-finish-load");
    expect(windows[0].posted).toEqual([{ channel: "mediaHost:capturePort", ports: [port] }]);
  });

  it("keeps only the newest channel while waiting, closing the one it replaces", () => {
    const { mediaHost, windows, consumer } = host();
    mediaHost.start(consumer);
    const first = fakePort("first");
    const second = fakePort("second");

    mediaHost.acceptPagePort(first);
    mediaHost.acceptPagePort(second);
    windows[0].fire("did-finish-load");

    expect(first.close).toHaveBeenCalled();
    expect(windows[0].posted.map(entry => entry.ports)).toEqual([[second]]);
  });

  it("closes a channel that arrives while no capture is running", () => {
    const { mediaHost } = host();
    const port = fakePort("stray");

    mediaHost.acceptPagePort(port);

    expect(port.close).toHaveBeenCalled();
  });

  it("routes packets and status from its own window to the consumer, and only then", () => {
    const { mediaHost, windows, consumer } = host();
    mediaHost.start(consumer);

    expect(mediaHost.ownsWebContents(windows[0].window.webContents)).toBe(true);
    expect(mediaHost.ownsWebContents({})).toBe(false);
    mediaHost.receivePackets(["packet"]);
    mediaHost.receiveStatus({ cfg: { sr: 48000 } });

    expect(consumer.onPackets).toHaveBeenCalledWith(["packet"]);
    expect(consumer.onStatus).toHaveBeenCalledWith({ cfg: { sr: 48000 } });
  });

  it("reports its renderer going away as a capture failure", () => {
    const { mediaHost, windows, consumer } = host();
    mediaHost.start(consumer);

    windows[0].fire("render-process-gone");

    expect(consumer.onStatus).toHaveBeenCalledWith({ error: "media host renderer gone" });
  });

  it("destroys the window on stop and forgets the consumer", () => {
    const { mediaHost, windows, consumer } = host();
    mediaHost.start(consumer);
    const waiting = fakePort("waiting");
    mediaHost.acceptPagePort(waiting);

    mediaHost.stop();
    mediaHost.receivePackets(["late"]);

    expect(windows[0].isDestroyed()).toBe(true);
    expect(waiting.close).toHaveBeenCalled();
    expect(consumer.onPackets).not.toHaveBeenCalled();
    expect(mediaHost.ownsWebContents(windows[0].window.webContents)).toBe(false);
  });
});

describe("media scheme", () => {
  it("serves the capture worklet at the address the page script loads", async () => {
    const enableSource = readFileSync("src/addons/bundled/rooms/scripts/audiocapture-enable.script.js", "utf8");
    const address = /addModule\("([^"]+)"\)/.exec(enableSource)?.[1];

    const response = serveMediaScheme({ url: address! });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript");
    expect(await response.text()).toContain('registerProcessor("ytmd-room-capture"');
  });

  it("serves nothing else", () => {
    expect(serveMediaScheme({ url: "ytmd-media://capture/other.js" }).status).toBe(404);
    expect(serveMediaScheme({ url: "ytmd-media://elsewhere/worklet.js" }).status).toBe(404);
  });
});
