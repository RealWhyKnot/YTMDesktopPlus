import { app } from "electron";
import log from "electron-log";
import path from "path";

import { isTestClient, isTestRun } from "../test-seams";

import { createDeepLinkRouter, findProtocolUrl } from "../deep-links";

import type { MainContext } from "../index";

export function initializeProtocol(context: MainContext): ReturnType<typeof createDeepLinkRouter> {
  const isGotTheLock = app.requestSingleInstanceLock();
  if (!isGotTheLock) {
    app.exit(0);
  } else {
    app.on("second-instance", (_, commandLine) => {
      if (context.mainWindow) {
        context.mainWindow.show();
        if (context.mainWindow.isMinimized()) {
          context.mainWindow.restore();
        }
        context.mainWindow.focus();
      }

      deepLinks.handleProtocol(findProtocolUrl(commandLine));
    });
  }

  const deepLinks = createDeepLinkRouter({ hasYtmView: () => context.ytmView !== null });

  if (!isTestClient() && !app.isDefaultProtocolClient("ytmdplus")) {
    if (process.defaultApp) {
      const entryPath = process.argv[1];
      if (entryPath !== undefined) {
        log.info("Application set as default protocol client for 'ytmdplus'");
        app.setAsDefaultProtocolClient("ytmdplus", process.execPath, [path.resolve(entryPath)]);
      }
    } else {
      log.info("Application set as default protocol client for 'ytmdplus'");
      app.setAsDefaultProtocolClient("ytmdplus", process.execPath);
    }
  }

  if (!isTestRun()) {
    const launchUrl = findProtocolUrl(process.argv);
    if (launchUrl) {
      log.info("Queuing protocol url from launch arguments", launchUrl);
      deepLinks.queueProtocolUrl(launchUrl);
    }
  }

  return deepLinks;
}
