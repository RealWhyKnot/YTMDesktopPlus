import { isYtmOrigin, YTM_ORIGIN } from "../ytm-navigation";

export function senderIsView(view: { webContents: object } | null, sender: object): boolean {
  return view !== null && sender === view.webContents;
}

export type SenderFrame = { readonly url: string; readonly parent: unknown };

export type SenderEvent = { readonly sender: object; readonly senderFrame?: SenderFrame | null };

export function senderFrameIsMainAt(event: SenderEvent, origins: readonly string[]): boolean {
  try {
    const frame = event.senderFrame;
    return frame?.parent === null && isYtmOrigin(frame.url, origins);
  } catch {
    return false;
  }
}

export type SenderGuardDeps = {
  getMainWindow(): { webContents: object } | null;
  getSettingsWindow(): { webContents: object } | null;
  getYtmView(): { webContents: object } | null;
  ownsAddonContents(sender: object): boolean;
};

const YTM_PAGE_ORIGINS: readonly string[] = [YTM_ORIGIN];

export function createSenderGuards(deps: SenderGuardDeps) {
  const isMainWindowSender = (sender: object) => senderIsView(deps.getMainWindow(), sender);
  const isSettingsSender = (sender: object) => senderIsView(deps.getSettingsWindow(), sender);
  const isYtmViewSender = (sender: object) => senderIsView(deps.getYtmView(), sender);
  const isYtmViewPage = (event: SenderEvent, origins: readonly string[] = YTM_PAGE_ORIGINS) =>
    isYtmViewSender(event.sender) && senderFrameIsMainAt(event, origins);
  const isMemoryStoreSender = (sender: object) => isMainWindowSender(sender) || isSettingsSender(sender) || deps.ownsAddonContents(sender);
  return { isMainWindowSender, isSettingsSender, isYtmViewSender, isYtmViewPage, isMemoryStoreSender };
}

export type AppWindowPermissionDeps = {
  isSettingsSender(sender: object): boolean;
  ownsAddonContents(sender: object): boolean;
};

export function appWindowPermissionAllowed(deps: AppWindowPermissionDeps, sender: object | null, permission: string): boolean {
  if (sender === null) return false;
  if (permission === "clipboard-sanitized-write") return deps.isSettingsSender(sender) || deps.ownsAddonContents(sender);
  return false;
}
