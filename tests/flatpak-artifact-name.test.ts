import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { ForgeMakeResult } from "@electron-forge/shared-types";
import { describe, expect, it } from "vitest";

import config from "../forge.config";

const postMake = config.hooks?.postMake;

async function runPostMake(result: unknown): Promise<ForgeMakeResult[]> {
  return (await postMake(null as never, [result] as never)) as ForgeMakeResult[];
}

function makeResult(artifactNames: string[], arch: string, version: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "ytmd-forge-"));
  const artifacts = artifactNames.map(name => {
    const file = path.join(dir, name);
    writeFileSync(file, "");
    return file;
  });
  return { artifacts, packageJSON: { version }, platform: "linux", arch };
}

describe("postMake flatpak rename", () => {
  it("stamps the version and flatpak arch onto the bundle", async () => {
    const result = makeResult(["dev.whyknot.YTMDesktopPlus_stable_x86_64.flatpak"], "x64", "2026.820.0-beta");

    const [renamed] = await runPostMake(result);

    expect(path.basename(renamed.artifacts[0])).toBe("YTMDesktopPlus-2026.820.0-beta-x86_64.flatpak");
    expect(existsSync(renamed.artifacts[0])).toBe(true);
  });

  it("maps arm64 to aarch64", async () => {
    const result = makeResult(["dev.whyknot.YTMDesktopPlus_stable_aarch64.flatpak"], "arm64", "2026.820.0-beta");

    const [renamed] = await runPostMake(result);

    expect(path.basename(renamed.artifacts[0])).toBe("YTMDesktopPlus-2026.820.0-beta-aarch64.flatpak");
  });

  it("leaves every other maker's artifacts alone", async () => {
    const names = ["YTMDesktopPlus-2026.820.0-beta.Setup.exe", "ytmdesktop-plus_2026.820.0.beta_amd64.deb"];
    const result = makeResult(names, "x64", "2026.820.0-beta");

    const [renamed] = await runPostMake(result);

    expect(renamed.artifacts.map((artifact: string) => path.basename(artifact))).toEqual(names);
  });
});
