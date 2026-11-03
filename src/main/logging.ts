import { app } from "electron";
import log from "electron-log";
import { isInitialDocumentBootstrapError, isSpamLogMessage, redactLogUrls } from "./log-filters";

const RENDERER_LEVEL = {
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error",
} as const;

const rendererLevels = new Map<string, log.LogLevel>(Object.entries(RENDERER_LEVEL));
type RendererConsoleDetails = { message: string; level: string; frame?: { url: string } };

function spyRendererConsole() {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("console-message", (details: RendererConsoleDetails) => {
      if (isInitialDocumentBootstrapError(details.message, details.frame?.url)) return;
      log.processMessage({
        data: [details.message],
        date: new Date(),
        level: rendererLevels.get(details.level) ?? "info",
        variables: { processType: "renderer" },
      });
    });
  });
}

export function setupLogging(isStartSilenced: boolean) {
  log.transports.file.sync = false;

  log.scope.labelPadding = false;
  log.transports.console.format = "[{processType}][{level}]{scope}{text}";
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}][{processType}][{level}]{scope}{text}";
  log.eventLogger.format = "Electron event {eventSource}#{eventName} observed";

  log.hooks.push((message, transport) => {
    if (transport !== log.transports.file) {
      return message;
    }

    if (message.data[0] && isSpamLogMessage(message.data[0])) return false;

    message.data = message.data.map((data: unknown): unknown => {
      if (typeof data === "string") {
        return redactLogUrls(data);
      }
      return data;
    });

    return message;
  });

  if (isStartSilenced) {
    setLogOutputEnabled(false);
  }

  log.initialize({
    preload: true,
    spyRendererConsole: false,
  });
  spyRendererConsole();
}

export function setLogOutputEnabled(isEnabled: boolean) {
  log.transports.file.level = isEnabled ? "silly" : false;
  log.transports.console.level = isEnabled ? "silly" : false;
}

export function switchLogFileToSync() {
  if (log.transports.file.level === false) return;
  Object.assign(log.transports.file.getFile(), { writeAsync: false });
}
