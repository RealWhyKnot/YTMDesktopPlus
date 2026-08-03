import log from "electron-log";
import { isSpamLogMessage, redactLogUrls } from "./log-filters";

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
    spyRendererConsole: true
  });
}

export function setLogOutputEnabled(enabled: boolean) {
  log.transports.file.level = enabled ? "silly" : false;
  log.transports.console.level = enabled ? "silly" : false;
}
