import { describe, expect, it } from "vitest";
import { UpdateChannel } from "../src/shared/store/schema";
import { buildUpdateFeedUrl, compareVersions, isNewerVersion, resolveUpdateChannel } from "../src/shared/update-feed";

describe("resolveUpdateChannel", () => {
  it("follows the installed build on Auto", () => {
    expect(resolveUpdateChannel(UpdateChannel.Auto, "2026.803.1")).toBe("stable");
    expect(resolveUpdateChannel(UpdateChannel.Auto, "2026.804.0-beta")).toBe("beta");
  });

  it("honours explicit overrides regardless of build", () => {
    expect(resolveUpdateChannel(UpdateChannel.Stable, "2026.804.0-beta")).toBe("stable");
    expect(resolveUpdateChannel(UpdateChannel.Beta, "2026.803.1")).toBe("beta");
  });
});

describe("buildUpdateFeedUrl", () => {
  it("builds the channel-aware feed URL", () => {
    expect(buildUpdateFeedUrl(UpdateChannel.Auto, "2026.803.1", "win32", "x64")).toBe("https://ytmdesktopplus.com/update/stable/win32-x64/2026.803.1");
    expect(buildUpdateFeedUrl(UpdateChannel.Beta, "2026.803.1", "win32", "x64")).toBe("https://ytmdesktopplus.com/update/beta/win32-x64/2026.803.1");
  });
});

describe("compareVersions", () => {
  it("orders by the numeric base", () => {
    expect(compareVersions("2026.803.1", "2026.803.2")).toBeLessThan(0);
    expect(compareVersions("2026.1201.0", "2026.804.5")).toBeGreaterThan(0);
    expect(compareVersions("2026.803.1", "2026.803.1")).toBe(0);
  });

  it("sorts a prerelease below its release and tolerates a leading v", () => {
    expect(compareVersions("2026.803.1-beta", "2026.803.1")).toBeLessThan(0);
    expect(compareVersions("v2026.803.2", "2026.803.1")).toBeGreaterThan(0);
  });
});

describe("isNewerVersion", () => {
  it("accepts only a strictly newer version", () => {
    expect(isNewerVersion("2026.803.2", "2026.803.1")).toBe(true);
    expect(isNewerVersion("v2026.804.0-beta", "2026.803.2")).toBe(true);
    expect(isNewerVersion("2026.803.1", "2026.803.2")).toBe(false);
    expect(isNewerVersion("2026.803.2", "2026.803.2")).toBe(false);
  });

  it("refuses anything it cannot read rather than guessing", () => {
    expect(isNewerVersion(null, "2026.803.1")).toBe(false);
    expect(isNewerVersion(undefined, "2026.803.1")).toBe(false);
    expect(isNewerVersion("", "2026.803.1")).toBe(false);
    expect(isNewerVersion("not a version", "2026.803.1")).toBe(false);
    expect(isNewerVersion("../evil", "2026.803.1")).toBe(false);
  });
});
