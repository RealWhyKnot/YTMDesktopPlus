const SPAM_PATTERNS = [/third-party cookie will be blocked\./i, /No handler registered for issue code/i, /Request Autofill\.(setAddresses|enable) failed/i];

export const isSpamLogMessage = (data: unknown): boolean => typeof data === "string" && SPAM_PATTERNS.some((pattern) => pattern.test(data));

const INITIAL_DOCUMENT_BOOTSTRAP_ERRORS = [
  /^Electron sandboxed_renderer\.bundle\.js script failed to run$/,
  /^TypeError: Cannot destructure property 'preloadScripts' of 'binding\.startupData' as it is null\./,
];

export const isInitialDocumentBootstrapError = (message: string, frameUrl: string | undefined): boolean =>
  frameUrl === "" && INITIAL_DOCUMENT_BOOTSTRAP_ERRORS.some((pattern) => pattern.test(message));

export const redactLogUrls = (data: string): string => data.replaceAll(/(?<=((https|http):\/\/)?.{1,64}(\..{1,64})?\..{1,64}\/)([\S]+)/gm, "[REDACTED]");
