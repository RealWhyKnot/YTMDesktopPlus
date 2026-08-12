import { app } from "electron";
import log from "electron-log";
import { isSpamLogMessage, redactLogUrls } from "./log-filters";

// electron-log's own renderer console spy still listens with the positional
// console-message signature Electron deprecated, which prints a warning on every
// launch. Its spy is switched off below and this does the same job.
const RENDERER_LEVEL = {
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error"
} as const;

function spyRendererConsole() {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("console-message", details => {
      log.processMessage({
        data: [details.message],
        date: new Date(),
        level: RENDERER_LEVEL[details.level] ?? "info",
        variables: { processType: "renderer" }
      });
    });
  });
}

export function setupLogging(startSilenced: boolean) {
  log.transports.console.format = "[{processType}][{level}]{text}";
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}][{processType}][{level}]{text}";
  log.eventLogger.format = "Electron event {eventSource}#{eventName} observed";

  log.hooks.push((message, transport) => {
    // If the transport is not a file transport then return as is
    if (transport !== log.transports.file) {
      return message;
    }
    // If there isnt message data, or the data isnt a string, or the data is spam from Youtube Music, return false
    if (message?.data?.[0] && isSpamLogMessage(message.data[0])) return false;

    // Check it is an array, then redact sensitive info
    message.data = message.data.map(data => {
      if (typeof data === "string") {
        return redactLogUrls(data);
      }
      return data;
    });

    return message;
  });

  if (startSilenced) {
    setLogOutputEnabled(false);
  }

  log.initialize({
    preload: true,
    spyRendererConsole: false
  });
  spyRendererConsole();
}

export function setLogOutputEnabled(enabled: boolean) {
  log.transports.file.level = enabled ? "silly" : false;
  log.transports.console.level = enabled ? "silly" : false;
}
