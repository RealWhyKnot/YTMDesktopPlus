import type { WebContents } from "electron";

export interface BroadcastTargets {
  getMainWindow(): { webContents: WebContents } | null;
  getSettingsWindow(): { webContents: WebContents } | null;
  getYtmView(): { webContents: WebContents } | null;
  addonWebContents(): Iterable<WebContents>;
}

export function createStoreBroadcaster(targets: BroadcastTargets) {
  return function broadcast(channel: string, options: { includeMainWindow: boolean }, ...args: unknown[]): void {
    // A BrowserView's webContents getter returns undefined once its owning
    // window is destroyed, so a null check on the holder is not enough.
    const send = (target: { webContents: WebContents } | null) => {
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
