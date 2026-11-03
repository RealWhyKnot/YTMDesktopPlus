import { createYtmContentsView } from "../windows/ytm-view-lifecycle";
import { app, dialog, Menu } from "electron";
import log from "electron-log";
import path from "path";

import { stallTasks } from "../stall-watch";

import { injectYtmExperimentFlags, isTestRun } from "../test-seams";

import { providePlaybackView } from "../playback";

import { classifyYtmNavigation, isPremiumRequiredRedirect } from "../ytm-navigation";

import type { MainContext } from "../index";

export function createYtmView(context: MainContext): void {
  context.memoryStore.set("ytmViewLoadTimedout", false);
  context.memoryStore.set("ytmViewLoading", true);
  context.memoryStore.set("ytmViewLoadingError", false);
  context.memoryStore.set("ytmViewLoadingStatus", "Initializing...");

  context.ytmView = stallTasks.timeSync("BrowserView create", () =>
    createYtmContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        partition: app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev",
        preload: path.join(__dirname, `../renderer/windows/ytmview/preload.js`),

        autoplayPolicy: "no-user-gesture-required",

        backgroundThrottling: false,
        additionalArguments: isTestRun() ? ["--ytmd-test"] : [],
      },
    })
  );
  context.companionServer.provide(context.store, context.memoryStore, context.ytmView);
  context.ratioVolume.provide(context.ytmView);
  context.nonStop.provide(context.ytmView);
  context.adBlocker.provideView(context.ytmView);
  providePlaybackView(() => context.ytmView);

  context.ytmView.webContents.setMaxListeners(64);
  injectYtmExperimentFlags(context.ytmView.webContents);

  context.ytmView.webContents.on("will-navigate", (event) => {
    const navigation = classifyYtmNavigation(event.url);
    if (navigation !== "allow") {
      event.preventDefault();
      log.info(`Blocking YTM View navigation to ${event.url}`);

      if (navigation === "openExternal") context.openExternalFromYtmView(event.url);
    }
  });
  context.ytmView.webContents.on("will-redirect", (event) => {
    if (classifyYtmNavigation(event.url) !== "allow") {
      event.preventDefault();
      log.info(`Blocking YTM View redirect to ${event.url}`);
    }

    if (isPremiumRequiredRedirect(event.url)) {
      void context
        .requireYtmView()
        .webContents.loadURL(
          "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F"
        )
        .catch((error: unknown) => log.warn("createYtmView failed", error));
    }
  });
  context.ytmView.webContents.on("did-navigate", context.ytmViewNavigated);
  context.ytmView.webContents.on("did-navigate-in-page", context.ytmViewNavigated);
  context.ytmView.webContents.on("enter-html-full-screen", () => {
    if (context.mainWindow) {
      context.mainWindow.setFullScreen(true);
    }
  });
  context.ytmView.webContents.on("leave-html-full-screen", () => {
    if (context.mainWindow) {
      context.mainWindow.setFullScreen(false);
    }
  });
  context.ytmView.webContents.on("render-process-gone", () => {
    context.saveState();
    context.createYTMView();
  });
  context.ytmView.webContents.on("page-title-updated", (_event, title) => {
    if (context.mainWindow) {
      context.mainWindow.setTitle(`${title} | YTMDesktop+`);
    }
  });
  context.ytmView.webContents.on("context-menu", (_event, params) => {
    if (context.store.get("developer").enableDevTools) {
      Menu.buildFromTemplate([
        {
          label: "YouTube Music Desktop",
          type: "normal",
          enabled: false,
        },
        {
          type: "separator",
        },
        {
          label: "Open Developer Tools",
          type: "normal",
          click: () => {
            if (context.ytmView) {
              context.ytmView.webContents.openDevTools({
                mode: "detach",
              });
            }
          },
        },
      ]).popup({
        window: context.mainWindow ?? undefined,
        x: params.x,
        y: params.y,
        sourceType: params.menuSourceType,
      });
    }
  });
  context.ytmView.webContents.on("will-prevent-unload", (event) => {
    if (context.mainWindow) {
      if (!context.isApplicationQuitting) {
        if (context.requireYtmView().webContents.getURL().startsWith("https://music.youtube.com/")) {
          const choice = stallTasks.timeSync("dialog showMessageBoxSync", () =>
            dialog.showMessageBoxSync(context.requireMainWindow(), {
              type: "question",
              buttons: ["Leave", "Stay"],
              title: "Navigation",
              message: "YouTube Music is preventing navigation. Do you want to leave or stay?",
              defaultId: 0,
              cancelId: 1,
            })
          );

          if (choice !== 0) {
            return;
          }
        }
      }
    }

    event.preventDefault();
  });
  context.ytmView.webContents.on("unresponsive", () => {
    context.memoryStore.set("ytmViewUnresponsive", true);
  });
  context.ytmView.webContents.on("responsive", () => {
    context.memoryStore.set("ytmViewUnresponsive", false);
  });

  context.ytmView.webContents.setWindowOpenHandler((details) => {
    context.openExternalFromYtmView(details.url);

    return {
      action: "deny",
    };
  });

  context.ytmView.webContents.on("did-start-loading", () => {
    context.memoryStore.set("ytmViewLoadingStatus", "Loading YouTube Music...");
  });

  context.ytmView.webContents.on("did-stop-loading", () => {
    if (!context.memoryStore.get("ytmViewLoadingError")) {
      context.memoryStore.set("ytmViewLoadingStatus", "Loaded YouTube Music");
    }
  });

  context.ytmView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      if (context.ytmViewLoadTimeout !== null) clearTimeout(context.ytmViewLoadTimeout);

      log.warn(`YTM view failed to load: ${errorDescription} (${errorCode})`);
      context.memoryStore.set("ytmViewLoadingError", true);
      context.memoryStore.set("ytmViewLoadingStatus", `Failed to load YouTube Music: ${errorDescription} (${errorCode})`);
    }
  });

  context.memoryStore.set("ytmViewLoadingStatus", "Initialized");

  let isNavigateDefault = true;

  const isContinueWhereYouLeftOff: boolean = context.store.get("playback").continueWhereYouLeftOff;
  if (isContinueWhereYouLeftOff) {
    const lastUrl: string = context.store.get("state").lastUrl;
    if (lastUrl) {
      if (lastUrl.startsWith("https://music.youtube.com/")) {
        void context.ytmView.webContents.loadURL(lastUrl).catch((error: unknown) => log.warn("createYtmView failed", error));
        isNavigateDefault = false;
      }
    }
  }

  if (isNavigateDefault) {
    void context.ytmView.webContents.loadURL("https://music.youtube.com/").catch((error: unknown) => log.warn("createYtmView failed", error));
    context.store.set("state.lastUrl", "https://music.youtube.com/");
  }

  context.ytmViewLoadTimeout = setTimeout(() => {
    context.memoryStore.set("ytmViewLoadTimedout", true);
  }, 30 * 1000);
}
