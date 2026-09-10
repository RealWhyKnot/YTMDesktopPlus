import { ipcRenderer } from "electron";
import type { ThemeCss } from "~shared/themes/sdk";

export type ThemeBridge = {
  getCss(): ThemeCss;
  onChanged(callback: (css: ThemeCss) => void): void;
};

export function createThemeBridge(): ThemeBridge {
  return {
    getCss: () => ipcRenderer.sendSync("themes:getActiveCss") as ThemeCss,
    onChanged: (callback: (css: ThemeCss) => void) => {
      ipcRenderer.on("themes:changed", (_event, css: ThemeCss) => callback(css));
    }
  };
}
