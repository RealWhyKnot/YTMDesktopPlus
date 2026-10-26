import type { WebContents } from "electron";
import { isYtmOrigin, YTM_ORIGIN } from "../ytm-navigation";

// Each guard is false while its window does not exist, so a channel is never
// open just because its window is closed.
export function senderIsView(view: { webContents: WebContents } | null, sender: WebContents): boolean {
  return view !== null && sender === view.webContents;
}

export type SenderFrame = { readonly url: string; readonly parent: unknown };

export type SenderEvent = { readonly sender: WebContents; readonly senderFrame?: SenderFrame | null };

export function senderFrameIsMainAt(event: SenderEvent, origins: readonly string[]): boolean {
  try {
    const frame = event.senderFrame;
    return frame !== null && frame !== undefined && frame.parent === null && isYtmOrigin(frame.url, origins);
  } catch {
    return false;
  }
}

export interface SenderGuardDeps {
  getMainWindow(): { webContents: WebContents } | null;
  getSettingsWindow(): { webContents: WebContents } | null;
  getYtmView(): { webContents: WebContents } | null;
  ownsAddonContents(sender: WebContents): boolean;
}

const YTM_PAGE_ORIGINS: readonly string[] = [YTM_ORIGIN];

export function createSenderGuards(deps: SenderGuardDeps) {
  const isMainWindowSender = (sender: WebContents) => senderIsView(deps.getMainWindow(), sender);
  const isSettingsSender = (sender: WebContents) => senderIsView(deps.getSettingsWindow(), sender);
  const isYtmViewSender = (sender: WebContents) => senderIsView(deps.getYtmView(), sender);
  const isYtmViewPage = (event: SenderEvent, origins: readonly string[] = YTM_PAGE_ORIGINS) =>
    isYtmViewSender(event.sender) && senderFrameIsMainAt(event, origins);
  const isMemoryStoreSender = (sender: WebContents) => isMainWindowSender(sender) || isSettingsSender(sender) || deps.ownsAddonContents(sender);
  return { isMainWindowSender, isSettingsSender, isYtmViewSender, isYtmViewPage, isMemoryStoreSender };
}

export type AppWindowPermissionDeps = {
  isSettingsSender(sender: WebContents): boolean;
  ownsAddonContents(sender: WebContents): boolean;
};

export function appWindowPermissionAllowed(deps: AppWindowPermissionDeps, sender: WebContents | null, permission: string): boolean {
  if (sender === null) return false;
  if (permission === "clipboard-sanitized-write") return deps.isSettingsSender(sender) || deps.ownsAddonContents(sender);
  return false;
}
