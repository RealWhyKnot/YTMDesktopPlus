import { WebContentsView, type BrowserWindow, type WebContents, type WebContentsViewConstructorOptions } from "electron";

const attachedViews = new WeakMap<BrowserWindow, Set<WebContentsView>>();
const owners = new WeakMap<WebContentsView, BrowserWindow>();

function contentsOf(view: { webContents?: WebContents | null }): WebContents | null | undefined {
  return view.webContents;
}

function setOwner(view: WebContentsView, window: BrowserWindow | null): void {
  const contents = contentsOf(view);
  if (contents === undefined || contents === null || contents.isDestroyed()) return;
  const setOwnerWindow: unknown = Reflect.get(contents, "_setOwnerWindow");
  if (typeof setOwnerWindow !== "function") throw new TypeError("Web contents cannot be attached to a window");
  Reflect.apply(setOwnerWindow, contents, [window]);
}

export function createYtmContentsView(options: WebContentsViewConstructorOptions): WebContentsView {
  const view = new WebContentsView({ ...options, webPreferences: Object.assign({}, options.webPreferences, { type: "browserView" }) });
  view.webContents.once("destroyed", () => {
    owners.get(view)?.contentView.removeChildView(view);
  });
  return view;
}

export function installYtmViewLifecycle(window: BrowserWindow): void {
  const views = new Set<WebContentsView>();
  attachedViews.set(window, views);
  window.once("closed", () => {
    for (const view of views) contentsOf(view)?.close({ waitForBeforeUnload: true });
    for (const view of views) owners.delete(view);
  });
}

export function detachYtmView(window: BrowserWindow, view: WebContentsView): void {
  const views = attachedViews.get(window);
  if (!views?.has(view)) return;
  window.contentView.removeChildView(view);
  setOwner(view, null);
  owners.delete(view);
  views.delete(view);
}

export function attachYtmView(window: BrowserWindow, view: WebContentsView): void {
  const views = attachedViews.get(window);
  if (views === undefined) throw new Error("View lifecycle is not installed");
  if (views.has(view)) return;
  const owner = owners.get(view);
  if (owner !== undefined && owner !== window) detachYtmView(owner, view);
  window.contentView.addChildView(view);
  setOwner(view, window);
  owners.set(view, window);
  views.add(view);
}
