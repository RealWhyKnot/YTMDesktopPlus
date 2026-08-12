import path from "path";
import { describe, expect, it } from "vitest";
import { buildExternalDefinition, scanExternalAddons } from "../src/main/addons/external-loader";
import { fakeAddonContext } from "./helpers/fake-addon-context";

// The template is loaded through the real external pipeline: scan, validate,
// createRequire of index.js, activate. If the SDK or loader drifts away from
// what the template shows authors, this fails in CI.
describe("the shipped addon template", () => {
  it("scans cleanly", () => {
    const scans = scanExternalAddons(path.resolve("examples"));
    expect(scans).toHaveLength(1);
    expect(scans[0].error).toBeUndefined();
    expect(scans[0].warnings).toBeUndefined();
    expect(scans[0].manifest?.id).toBe("addon-template");
  });

  it("activates against the real loader and wires every advertised surface", async () => {
    const scan = scanExternalAddons(path.resolve("examples"))[0];
    const definition = buildExternalDefinition(scan.dir, scan.manifest);
    const { ctx, captured, fireLoaded } = fakeAddonContext({ manifest: scan.manifest });

    const instance = await definition.activate(ctx);

    expect(ctx.ytmview.watchCSSFile).toHaveBeenCalledWith(path.join(scan.dir, "styles.css"));
    expect(captured.scripts["page.script"]).toContain("__YTMD_HOOK__");
    expect(captured.sections.flatMap(section => section.fields.map(field => field.key))).toEqual(["showBadge", "greeting", "mode"]);
    const mode = captured.sections.flatMap(section => section.fields).find(field => field.key === "mode");
    expect(mode?.type === "select" && mode.options.every(option => typeof option.value === "string")).toBe(true);
    expect(captured.badges.at(-1)).toMatchObject({ icon: "waving_hand" });
    expect(captured.eventListeners["trackChanged"]).toHaveLength(1);

    // Page load: the loader auto-runs the script and the addon invokes it.
    fireLoaded();
    await Promise.resolve();
    expect(ctx.ytmview.runScript).toHaveBeenCalledWith("page.script");
    expect(captured.invocations.some(call => call.name === "page.script")).toBe(true);

    await (instance as { destroy(): void } | undefined)?.destroy();
    expect(captured.badges.at(-1)).toBeNull();
  });
});
