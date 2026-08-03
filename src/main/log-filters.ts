export const isSpamLogMessage = (data: unknown): boolean => typeof data === "string" && /third-party cookie will be blocked\./i.test(data);

// Strips everything after the hostname so URLs with tokens or video ids never
// end up in the log file.
export const redactLogUrls = (data: string): string => data.replaceAll(/(?<=((https|http):\/\/)?.{1,64}(\..{1,64})?\..{1,64}\/)([\S]+)/gm, "[REDACTED]");
