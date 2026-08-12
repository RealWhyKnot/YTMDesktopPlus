import { describe, expect, it } from "vitest";
import { isSpamLogMessage, redactLogUrls } from "../src/main/log-filters";

describe("isSpamLogMessage", () => {
  it("matches the third-party cookie warning", () => {
    expect(isSpamLogMessage("Reading cookie in cross-site context will be blocked... third-party cookie will be blocked.")).toBe(true);
  });

  it("matches the devtools issue channel complaining about unknown categories", () => {
    expect(isSpamLogMessage("No handler registered for issue code PerformanceIssue")).toBe(true);
  });

  it("matches the Autofill domain Electron does not implement", () => {
    expect(isSpamLogMessage(`Request Autofill.enable failed. {"code":-32601,"message":"'Autofill.enable' wasn't found"}`)).toBe(true);
    expect(isSpamLogMessage(`Request Autofill.setAddresses failed. {"code":-32601}`)).toBe(true);
  });

  it("ignores normal messages and non-strings", () => {
    expect(isSpamLogMessage("Integration enabled: Companion Server")).toBe(false);
    // Near miss: a real failure that happens to mention autofill must survive.
    expect(isSpamLogMessage("Autofill request failed for the settings window")).toBe(false);
    expect(isSpamLogMessage(42)).toBe(false);
    expect(isSpamLogMessage(undefined)).toBe(false);
  });
});

describe("redactLogUrls", () => {
  it("redacts paths after a hostname", () => {
    const redacted = redactLogUrls("loading https://music.youtube.com/watch?v=secretVideoId failed");
    expect(redacted).not.toContain("secretVideoId");
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).toContain("music.youtube.com");
  });

  it("leaves plain messages alone", () => {
    expect(redactLogUrls("Integration enabled: Companion Server")).toBe("Integration enabled: Companion Server");
  });
});
