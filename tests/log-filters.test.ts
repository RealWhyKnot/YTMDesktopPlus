import { describe, expect, it } from "vitest";
import { isSpamLogMessage, redactLogUrls } from "../src/main/log-filters";

describe("isSpamLogMessage", () => {
  it("matches the third-party cookie warning", () => {
    expect(isSpamLogMessage("Reading cookie in cross-site context will be blocked... third-party cookie will be blocked.")).toBe(true);
  });

  it("ignores normal messages and non-strings", () => {
    expect(isSpamLogMessage("Integration enabled: Custom CSS")).toBe(false);
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
