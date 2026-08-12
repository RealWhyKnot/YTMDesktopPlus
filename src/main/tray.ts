import path from "path";
import { app, Menu, nativeTheme, Tray } from "electron";
import type Conf from "conf";
import { StoreSchema, TrayIconStyle } from "../shared/store/schema";

export interface TrayDeps {
  store: Conf<StoreSchema>;
  getMainWindow(): Electron.BrowserWindow | null;
  sendRemoteCommand(command: string): void;
  addonTrayItems(): { label: string; enabled: boolean; click: () => void }[];
}

export interface TrayController {
  createTray(): void;
  setTrayIcon(): void;
  refreshTrayMenu(): void;
}

export function createTrayController(deps: TrayDeps): TrayController {
  let tray: Tray = null;

  function trayIconFileName(style: TrayIconStyle) {
    if (process.platform === "win32") return "tray.ico";
    if (process.platform === "darwin") return "trayTemplate.png";

    let color: "white" | "black";
    if (style === TrayIconStyle.White) {
      color = "white";
    } else if (style === TrayIconStyle.Black) {
      color = "black";
    } else {
      color = nativeTheme.shouldUseDarkColors ? "white" : "black";
    }
    return `ytmd_${color}.png`;
  }

  function getTrayIconPath() {
    const style = deps.store.get("appearance").trayIconStyle;
    const iconsDir = process.env.NODE_ENV === "development" ? path.join(app.getAppPath(), "src/assets/icons") : process.resourcesPath;
    return path.join(iconsDir, trayIconFileName(style));
  }

  // The static menu plus whatever tray items addons registered; rebuilt through
  // refreshTrayMenu whenever those change.
  function buildTrayContextMenu(): Electron.MenuItemConstructorOptions[] {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: "YouTube Music Desktop",
        type: "normal",
        enabled: false
      },
      {
        type: "separator"
      },
      {
        label: "Show/Hide Window",
        type: "normal",
        click: () => {
          const mainWindow = deps.getMainWindow();
          if (mainWindow) {
            if (mainWindow.isVisible()) {
              mainWindow.hide();
            } else {
              mainWindow.show();
            }
          }
        }
      },
      {
        label: "Play/Pause",
        type: "normal",
        click: () => {
          deps.sendRemoteCommand("playPause");
        }
      },
      {
        label: "Previous",
        type: "normal",
        click: () => {
          deps.sendRemoteCommand("previous");
        }
      },
      {
        label: "Next",
        type: "normal",
        click: () => {
          deps.sendRemoteCommand("next");
        }
      }
    ];

    const addonItems = deps.addonTrayItems();
    if (addonItems.length > 0) {
      template.push({ type: "separator" });
      for (const item of addonItems) {
        template.push({ label: item.label, type: "normal", enabled: item.enabled, click: item.click });
      }
    }

    template.push(
      { type: "separator" },
      {
        label: "Quit",
        type: "normal",
        click: () => {
          app.quit();
        }
      }
    );
    return template;
  }

  return {
    createTray() {
      tray = new Tray(getTrayIconPath());
      tray.setToolTip("YouTube Music Desktop");
      tray.setContextMenu(Menu.buildFromTemplate(buildTrayContextMenu()));
      tray.on("click", () => {
        const mainWindow = deps.getMainWindow();
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          } else {
            mainWindow.show();
          }
        }
      });
    },
    setTrayIcon() {
      tray.setImage(getTrayIconPath());
    },
    refreshTrayMenu() {
      if (tray) tray.setContextMenu(Menu.buildFromTemplate(buildTrayContextMenu()));
    }
  };
}
