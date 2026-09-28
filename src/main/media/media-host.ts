import { MessageChannelMain, type MessagePortMain } from "electron";
import workletSource from "./room-capture.worklet?raw";

export const MEDIA_SCHEME = "ytmd-media";
export const MEDIA_SCHEME_PRIVILEGES = { standard: true, secure: true, bypassCSP: true, supportFetchAPI: true, corsEnabled: true };

const WORKLET_HOST = "capture";
const WORKLET_PATH = "/worklet.js";

export function serveMediaScheme(request: { url: string }): Response {
  const url = new URL(request.url);
  if (url.host !== WORKLET_HOST || url.pathname !== WORKLET_PATH) return new Response(null, { status: 404 });
  return new Response(workletSource, { headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" } });
}

export type MediaHostWindow = {
  isDestroyed(): boolean;
  destroy(): void;
  webContents: {
    postMessage(channel: string, message: unknown, transfer?: MessagePortMain[]): void;
    once(event: "did-finish-load", listener: () => void): unknown;
    on(event: "render-process-gone", listener: () => void): unknown;
  };
};

export type MediaHostConsumer = {
  onStatus(status: { error: string }): void;
};

export class MediaHost {
  private createWindow: (() => MediaHostWindow) | null = null;
  private window: MediaHostWindow | null = null;
  private loaded = false;
  private pendingPort: MessagePortMain | null = null;
  private consumer: MediaHostConsumer | null = null;
  private uplink: ((port: MessagePortMain) => void) | null = null;

  constructor(private readonly createChannel: () => { port1: MessagePortMain; port2: MessagePortMain }) {}

  provide(createWindow: () => MediaHostWindow) {
    this.createWindow = createWindow;
  }

  start(consumer: MediaHostConsumer) {
    this.consumer = consumer;
    if (this.window && !this.window.isDestroyed()) return;
    if (!this.createWindow) throw new Error("media host has no window factory");

    const window = this.createWindow();
    this.window = window;
    this.loaded = false;
    window.webContents.once("did-finish-load", () => {
      if (this.window !== window) return;
      this.loaded = true;
      this.pairUplink();
      if (this.pendingPort) this.deliver(this.pendingPort);
      this.pendingPort = null;
    });
    window.webContents.on("render-process-gone", () => {
      if (this.window === window) this.consumer?.onStatus({ error: "media host renderer gone" });
    });
  }

  stop() {
    this.consumer = null;
    this.pendingPort?.close();
    this.pendingPort = null;
    const window = this.window;
    this.window = null;
    this.loaded = false;
    if (window && !window.isDestroyed()) window.destroy();
  }

  acceptPagePort(port: MessagePortMain) {
    if (!this.window) {
      port.close();
      return;
    }
    if (this.loaded) {
      this.deliver(port);
      return;
    }
    this.pendingPort?.close();
    this.pendingPort = port;
  }

  connectUplink(send: (port: MessagePortMain) => void) {
    this.uplink = send;
    this.pairUplink();
  }

  private pairUplink() {
    if (!this.uplink || !this.window || !this.loaded) return;
    const { port1, port2 } = this.createChannel();
    this.window.webContents.postMessage("mediaHost:uplinkPort", null, [port1]);
    this.uplink(port2);
  }

  private deliver(port: MessagePortMain) {
    this.window?.webContents.postMessage("mediaHost:capturePort", null, [port]);
  }
}

export const mediaHost = new MediaHost(() => new MessageChannelMain());
