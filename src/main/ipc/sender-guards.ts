import type { WebContents } from "electron";

// Each guard is false while its window does not exist, so a channel is never
// open just because its window is closed.
export function senderIsView(view: { webContents: WebContents } | null, sender: WebContents): boolean {
  return view !== null && sender === view.webContents;
}

export interface SenderGuardDeps {
  getMainWindow(): { webContents: WebContents } | null;
  getSettingsWindow(): { webContents: WebContents } | null;
  getYtmView(): { webContents: WebContents } | null;
  ownsAddonContents(sender: WebContents): boolean;
}

export function createSenderGuards(deps: SenderGuardDeps) {
  const isMainWindowSender = (sender: WebContents) => senderIsView(deps.getMainWindow(), sender);
  const isSettingsSender = (sender: WebContents) => senderIsView(deps.getSettingsWindow(), sender);
  const isYtmViewSender = (sender: WebContents) => senderIsView(deps.getYtmView(), sender);
  const isMemoryStoreSender = (sender: WebContents) => isMainWindowSender(sender) || isSettingsSender(sender) || deps.ownsAddonContents(sender);
  return { isMainWindowSender, isSettingsSender, isYtmViewSender, isMemoryStoreSender };
}
