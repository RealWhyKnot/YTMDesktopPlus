import { describe, expect, it } from "vitest";
import { UpdateChannel } from "../src/shared/store/schema";
import { buildUpdateFeedUrl, resolveUpdateChannel } from "../src/shared/update-feed";

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
