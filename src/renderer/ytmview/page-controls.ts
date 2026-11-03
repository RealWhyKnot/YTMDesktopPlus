import pageControlsCss from "./page-controls.css?raw";
import hostControlsCss from "./page-controls.user.css?raw";
import { ipcRenderer } from "electron";
import { executePageScript } from "./execute-page-script";
import { isRecord } from "~shared/unknown";
import playerBarControlsScript from "./scripts/playerbarcontrols.script?raw";
import hookPlayerApiEventsScript from "./scripts/hookplayerapievents.script?raw";

const THEME_STYLE_ID = "ytmd-theme";

export function applyThemeStyle(css: string) {
  let element = document.getElementById(THEME_STYLE_ID);
  if (element === null) {
    element = document.createElement("style");
    element.id = THEME_STYLE_ID;
    document.head.appendChild(element);
  }
  element.textContent = css;
}

export function createThemeStyleSheet() {
  const css: unknown = ipcRenderer.sendSync("themes:getActiveCss");
  if (!isRecord(css) || typeof css.ytm !== "string") throw new TypeError("Invalid theme CSS");
  applyThemeStyle(css.ytm);
  ipcRenderer.on("themes:changed", (_event, next: unknown) => {
    if (isRecord(next) && typeof next.ytm === "string") applyThemeStyle(next.ytm);
  });
}

export function createStyleSheet() {
  const css = document.createElement("style");
  css.appendChild(document.createTextNode(`${pageControlsCss}\n${hostControlsCss}`));
  document.head.appendChild(css);
}

export function createMaterialSymbolsLink() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100,0,0";
  return link;
}

export function createNavigationMenuArrows() {
  const historyBackElement = document.createElement("span");
  historyBackElement.classList.add("material-symbols-outlined", "ytmd-history-back");
  historyBackElement.setAttribute("aria-disabled", "true");
  historyBackElement.innerText = "west";

  historyBackElement.addEventListener("click", function () {
    if (!historyBackElement.hasAttribute("aria-disabled")) {
      history.back();
    }
  });

  const historyForwardElement = document.createElement("span");
  historyForwardElement.classList.add("material-symbols-outlined", "ytmd-history-forward");
  historyForwardElement.setAttribute("aria-disabled", "true");
  historyForwardElement.innerText = "east";

  historyForwardElement.addEventListener("click", function () {
    if (!historyForwardElement.hasAttribute("aria-disabled")) {
      history.forward();
    }
  });

  ipcRenderer.on("ytmView:navigationStateChanged", (_event, state: unknown) => {
    if (!isRecord(state)) return;
    if (state.canGoBack) {
      historyBackElement.removeAttribute("aria-disabled");
    } else {
      historyBackElement.setAttribute("aria-disabled", "true");
    }

    if (state.canGoForward) {
      historyForwardElement.removeAttribute("aria-disabled");
    } else {
      historyForwardElement.setAttribute("aria-disabled", "true");
    }
  });

  const pivotBar = document.querySelector("ytmusic-pivot-bar-renderer");
  if (!pivotBar) {
    const searchBar = document.querySelector("ytmusic-search-box");
    const navBar = searchBar?.parentNode;
    if (!searchBar || !navBar) throw new Error("YouTube Music search navigation is unavailable");
    navBar.insertBefore(historyForwardElement, searchBar);
    navBar.insertBefore(historyBackElement, historyForwardElement);
  } else {
    historyForwardElement.classList.add("pivotbar");
    historyBackElement.classList.add("pivotbar");
    pivotBar.prepend(historyForwardElement);
    pivotBar.prepend(historyBackElement);
  }
}

export function createKeyboardNavigation() {
  const keyboardNavigation = document.createElement("div");
  keyboardNavigation.tabIndex = 32767;
  keyboardNavigation.onfocus = () => {
    keyboardNavigation.blur();
    ipcRenderer.send("ytmView:switchFocus", "main");
  };
  document.body.appendChild(keyboardNavigation);
}

export async function createAdditionalPlayerBarControls() {
  (await executePageScript(playerBarControlsScript))();
}

export async function hideChromecastButton() {
  (
    await executePageScript(`
      (function() {
        window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_CAST_AVAILABLE', payload: false });
      })
    `)
  )();
}

export async function hookPlayerApiEvents() {
  (await executePageScript(hookPlayerApiEventsScript))();
}

export function overrideHistoryButtonDisplay() {
  const historyButton = document.querySelector<HTMLElement>("#history-link .history-button");
  if (historyButton === null) throw new Error("YouTube Music history button is unavailable");
  historyButton.removeAttribute("style");
  historyButton.classList.add("ytmd-history-button");
}

export function getYTMTextRun(runs: { text: string }[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}
