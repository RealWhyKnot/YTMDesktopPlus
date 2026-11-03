import type { WebContents } from "electron";

type BroadcastContents = Pick<WebContents, "send" | "isDestroyed">;

export type BroadcastTargets = {
  getMainWindow(): { webContents?: BroadcastContents } | null;
  getSettingsWindow(): { webContents?: BroadcastContents } | null;
  getYtmView(): { webContents?: BroadcastContents } | null;
  addonWebContents(): Iterable<BroadcastContents>;
};

export function createStoreBroadcaster(targets: BroadcastTargets) {
  return function broadcast(channel: string, options: { includeMainWindow: boolean }, ...args: unknown[]): void {
    const send = (target: { webContents?: BroadcastContents } | null) => {
      if (target?.webContents && !target.webContents.isDestroyed()) {
        target.webContents.send(channel, ...args);
      }
    };

    if (options.includeMainWindow) {
      send(targets.getMainWindow());
    }
    send(targets.getSettingsWindow());
    send(targets.getYtmView());

    for (const contents of targets.addonWebContents()) {
      if (!contents.isDestroyed()) {
        contents.send(channel, ...args);
      }
    }
  };
}
