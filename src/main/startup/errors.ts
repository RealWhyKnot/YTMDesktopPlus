import { app, clipboard, dialog } from "electron";
import log from "electron-log";

import { switchLogFileToSync } from "../logging";
import { stallTasks } from "../stall-watch";

import type { MainContext } from "../index";

export function installErrorHandler(context: MainContext): void {
  const onError = async ({ error, processType, versions }: Parameters<NonNullable<log.MainErrorHandlerOptions["onError"]>>[0]) => {
    if (context.isApplicationExited) return;
    if (processType === "renderer") return;

    if (context.stateSaverInterval) clearInterval(context.stateSaverInterval);
    switchLogFileToSync();

    if (error instanceof AggregateError) {
      log.error(error);
      for (const subError of error.errors) {
        log.error(subError);
      }
    } else {
      log.error(error);
    }

    let result = 1;

    const cause: unknown = error.cause ?? "Unknown";
    if (typeof cause === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
    const causeText = String(cause);
    const dialogMessage =
      `Environment Details:\n    ${versions.app}\n    ${versions.electron}\n    ${versions.os}\n\n` +
      `Name: ${error.name}\nMessage: ${error.message}\nCause: ${causeText}\n\n` +
      `${error.stack}`;

    if (!app.isReady()) {
      stallTasks.timeSync("dialog showErrorBox", () => dialog.showErrorBox(`YTMDesktop+ Crashed`, `Application crashed before ready\n\n${dialogMessage}`));
    } else {
      const options = ["Copy to Clipboard and Exit", "Exit"];
      if (!app.isPackaged) {
        options.push("Copy to Clipboard and Continue", "Continue");
      }

      result = stallTasks.timeSync("dialog showMessageBoxSync", () =>
        dialog.showMessageBoxSync({
          title: "Error",
          message: "YTMDesktop+ Crashed",
          detail: dialogMessage,
          type: "error",
          buttons: options,
        })
      );

      if (result === 0 || result === 2) {
        try {
          await clipboard.writeText(`YTMDesktop+ Crashed\n\n${dialogMessage}`);
        } catch (clipboardError) {
          log.error(clipboardError);
        }
      }
    }

    if (result === 0 || result === 1) {
      context.isApplicationExited = true;
      try {
        context.store.flushSync();
      } catch (flushError) {
        log.error(flushError);
      }
      app.exit(1);
    }
  };
  log.errorHandler.startCatching({
    showDialog: false,
    onError(details) {
      void onError(details).catch((error: unknown) => log.error("Could not handle the application error", error));
    },
  });
}
