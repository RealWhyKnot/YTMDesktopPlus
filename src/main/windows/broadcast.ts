import type { WebContents } from "electron";

export interface BroadcastTargets {
  getMainWindow(): { webContents: WebContents } | null;
  getSettingsWindow(): { webContents: WebContents } | null;
  getYtmView(): { webContents: WebContents } | null;
  addonWebContents(): Iterable<WebContents>;
}

export function createStoreBroadcaster(targets: BroadcastTargets) {
  return function broadcast(channel: string, options: { includeMainWindow: boolean }, ...args: unknown[]): void {
    const mainWindow = targets.getMainWindow();
    if (options.includeMainWindow && mainWindow !== null) {
      mainWindow.webContents.send(channel, ...args);
    }

    const settingsWindow = targets.getSettingsWindow();
    if (settingsWindow !== null) {
      settingsWindow.webContents.send(channel, ...args);
    }

    const ytmView = targets.getYtmView();
    if (ytmView !== null) {
      ytmView.webContents.send(channel, ...args);
    }

    for (const contents of targets.addonWebContents()) {
      contents.send(channel, ...args);
    }
  };
}
