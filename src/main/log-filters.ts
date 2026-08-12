// Console noise the app can do nothing about, from Chromium and from the pages
// it loads. Filtered so a real problem is visible in the log rather than buried.
const SPAM_PATTERNS = [
  // Chromium's own cookie deprecation notice, repeated per request.
  /third-party cookie will be blocked\./i,
  // The DevTools issues channel reports categories the bundled frontend does not
  // know about. Nothing is wrong and there is no handler to add.
  /No handler registered for issue code/i,
  // Electron ships without the Autofill domain that Chromium's frontend asks
  // for on startup. Upstream: electron/electron#41614.
  /Request Autofill\.(setAddresses|enable) failed/i
];

export const isSpamLogMessage = (data: unknown): boolean => typeof data === "string" && SPAM_PATTERNS.some(pattern => pattern.test(data));

// Strips everything after the hostname so URLs with tokens or video ids never
// end up in the log file.
export const redactLogUrls = (data: string): string => data.replaceAll(/(?<=((https|http):\/\/)?.{1,64}(\..{1,64})?\..{1,64}\/)([\S]+)/gm, "[REDACTED]");
