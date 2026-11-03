import { describe, expect, it } from "vitest";
import { canSelfUpdate, canShowUpdateNotice, type UpdateClient } from "../src/main/startup/update-eligibility";

const windowsRelease: UpdateClient = {
  isPackaged: true,
  platform: "win32",
  isLocalBuild: false,
  isUpdatesDisabled: false,
  isTestClient: false,
};

const linuxRelease: UpdateClient = { ...windowsRelease, platform: "linux" };

const blockers: [string, Partial<UpdateClient>][] = [
  ["a test client", { isTestClient: true }],
  ["an unpackaged run", { isPackaged: false }],
  ["a local build", { isLocalBuild: true }],
  ["a build with updates turned off", { isUpdatesDisabled: true }],
];

describe("canSelfUpdate", () => {
  it("lets a packaged Windows release update itself", () => {
    expect(canSelfUpdate(windowsRelease)).toBe(true);
  });

  it.each(blockers)("refuses %s on Windows", (_name, change) => {
    expect(canSelfUpdate({ ...windowsRelease, ...change })).toBe(false);
  });

  it.each(["linux", "darwin"] as const)("refuses a packaged %s release", (platform) => {
    expect(canSelfUpdate({ ...windowsRelease, platform })).toBe(false);
  });
});

describe("canShowUpdateNotice", () => {
  it("shows the notice on a packaged Linux release", () => {
    expect(canShowUpdateNotice(linuxRelease)).toBe(true);
  });

  it.each(blockers)("skips the notice for %s on Linux", (_name, change) => {
    expect(canShowUpdateNotice({ ...linuxRelease, ...change })).toBe(false);
  });

  it.each(["win32", "darwin"] as const)("skips the notice on a packaged %s release", (platform) => {
    expect(canShowUpdateNotice({ ...linuxRelease, platform })).toBe(false);
  });
});
