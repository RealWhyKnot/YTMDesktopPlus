import path from "node:path";
import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from "electron";

// Mirrors --bg/--text-muted in src/assets/app.css; the main process cannot
// read CSS.
export const TITLE_BAR_OVERLAY = {
  color: "#000000",
  symbolColor: "#BBBBBB",
  height: 36
};

type AppWindowOptions = BrowserWindowConstructorOptions & {
  // window.open targets opened in the system browser; everything else is denied.
  openExternalUrls?: string[];
};

export function createAppWindow(options: AppWindowOptions): BrowserWindow {
  const { openExternalUrls, webPreferences, ...rest } = options;
  const window = new BrowserWindow({
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: TITLE_BAR_OVERLAY,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      ...webPreferences
    },
    ...rest
  });

  window.webContents.setWindowOpenHandler(details => {
    if (openExternalUrls?.includes(details.url)) {
      shell.openExternal(details.url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", event => {
    if (process.env.NODE_ENV === "development" && event.url.startsWith("http://localhost")) return;

    event.preventDefault();
  });

  return window;
}

export function loadWindowEntry(window: BrowserWindow, entry: string, devServerUrl: string | undefined): void {
  if (devServerUrl) window.loadURL(`${devServerUrl}/windows/${entry}/index.html`);
  else window.loadFile(path.join(__dirname, `../renderer/windows/${entry}/index.html`));
}
