import type { AppWindow } from "../app-window";
declare const window: AppWindow;
import "material-symbols/outlined.css";
import "~assets/app.css";

import { createApp, type Component } from "vue";
import type { ThemeBridge } from "./theme-bridge";
import { isRecord } from "~shared/unknown";

const THEME_STYLE_ID = "ytmd-theme";

function isThemeBridge(value: unknown): value is ThemeBridge {
  return isRecord(value) && typeof value.getCss === "function" && typeof value.onChanged === "function";
}

function applyTheme(css: string): void {
  let element = document.getElementById(THEME_STYLE_ID);
  if (element === null) {
    element = document.createElement("style");
    element.id = THEME_STYLE_ID;
    document.head.appendChild(element);
  }
  element.textContent = css;
}

export function mountWindow(root: Component): void {
  const bridge: unknown = window.ytmd;
  const theme: unknown = isRecord(bridge) ? bridge.theme : undefined;
  if (isThemeBridge(theme)) {
    try {
      applyTheme(theme.getCss().app);
      theme.onChanged((css) => applyTheme(css.app));
    } catch (error) {
      console.warn("Theme could not be applied", error);
    }
  }
  createApp(root).mount("#app");
}
