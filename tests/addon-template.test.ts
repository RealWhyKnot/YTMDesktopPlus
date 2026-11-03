import { requireValue } from "./helpers/require-value";
import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { buildExternalDefinition, scanExternalAddons } from "../src/main/addons/external-loader";
import { fakeAddonContext } from "./helpers/fake-addon-context";
import { buildAddonTemplate } from "../tools/build-addon-template.ts";

const fixtureRoot = path.resolve(".vite", "addon-template-test");
await buildAddonTemplate(path.join(fixtureRoot, "addon-template"));
afterAll(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

describe("the shipped addon template", () => {
  it("scans cleanly", () => {
    const scans = scanExternalAddons(fixtureRoot);
    expect(scans).toHaveLength(1);
    expect(requireValue(scans[0]).error).toBeUndefined();
    expect(requireValue(scans[0]).warnings).toBeUndefined();
    expect(requireValue(scans[0]).manifest?.id).toBe("addon-template");
  });

  it("activates against the real loader and wires every advertised surface", async () => {
    const scan = scanExternalAddons(fixtureRoot)[0];
    const definition = buildExternalDefinition(requireValue(scan).dir, requireValue(requireValue(scan).manifest));
    const { ctx, captured, fireLoaded } = fakeAddonContext({ manifest: requireValue(scan).manifest });

    const instance = await definition.activate(ctx);

    expect(ctx.ytmview.watchCSSFile).toHaveBeenCalledWith(path.join(requireValue(scan).dir, "styles.css"));
    expect(captured.scripts["page.script"]).toContain("__YTMD_HOOK__");
    expect(captured.sections.flatMap((section) => section.fields.map((field) => field.key))).toEqual(["showBadge", "greeting", "mode", "openPanel"]);
    const mode = captured.sections.flatMap((section) => section.fields).find((field) => field.key === "mode");
    expect(mode?.type === "select" && mode.options.every((option) => typeof option.value === "string")).toBe(true);
    expect(captured.badges.at(-1)).toMatchObject({ icon: "waving_hand" });
    expect(captured.eventListeners.trackChanged).toHaveLength(1);

    requireValue(captured.actionCallbacks.openPanel).call(captured.actionCallbacks);
    expect(ctx.windows.create).toHaveBeenCalledWith(expect.objectContaining({ file: "panel.html" }));

    fireLoaded();
    await Promise.resolve();
    expect(ctx.ytmview.runScript).toHaveBeenCalledWith("page.script");
    expect(captured.invocations.some((call) => call.name === "page.script")).toBe(true);

    if (instance) await instance.destroy?.();
    expect(captured.badges.at(-1)).toBeNull();
  });

  it("ships a panel that builds on the addon window class kit", () => {
    const scan = scanExternalAddons(fixtureRoot)[0];
    const html = fs.readFileSync(path.join(requireValue(scan).dir, "panel.html"), "utf8");

    expect(html).toContain("ytmd-card");
    expect(html).toContain("ytmd-drag");
    expect(html).toContain("ytmd-no-drag");
    expect(html).toContain("ytmd-button primary");
    expect(html).toContain("ytmdAddon.closeWindow()");
  });
});
