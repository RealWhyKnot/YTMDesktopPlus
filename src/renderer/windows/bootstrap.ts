import "material-symbols/outlined.css";
import "~assets/app.css";

import { createApp, type Component } from "vue";
import type { ThemeBridge } from "./theme-bridge";

const THEME_STYLE_ID = "ytmd-theme";

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
  const theme = (window as unknown as { ytmd?: { theme?: ThemeBridge } }).ytmd?.theme;
  if (theme) {
    try {
      applyTheme(theme.getCss().app);
      theme.onChanged(css => applyTheme(css.app));
    } catch (error) {
      console.warn("Theme could not be applied", error);
    }
  }
  createApp(root).mount("#app");
}
