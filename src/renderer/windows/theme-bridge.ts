import { ipcRenderer } from "electron";
import type { ThemeCss } from "~shared/themes/sdk";
import { isThemeCss } from "~shared/themes/validate-descriptor";

export type ThemeBridge = {
  getCss(): ThemeCss;
  onChanged(callback: (css: ThemeCss) => void): void;
};

export function createThemeBridge(): ThemeBridge {
  return {
    getCss: () => {
      const css: unknown = ipcRenderer.sendSync("themes:getActiveCss");
      if (!isThemeCss(css)) throw new TypeError("Invalid theme CSS");
      return css;
    },
    onChanged: (callback: (css: ThemeCss) => void) => {
      ipcRenderer.on("themes:changed", (_event, css: unknown) => {
        if (!isThemeCss(css)) throw new TypeError("Invalid theme CSS");
        callback(css);
      });
    },
  };
}
