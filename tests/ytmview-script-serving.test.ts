import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Addons invoke page scripts as soon as player state starts reaching the main
// process. The renderer answers those invokes from a listener registered in
// startHooking, and the main process drops an unanswered invoke after 30s with
// no retry, so serving has to be wired up before the state pump starts.
describe("ytmview script serving", () => {
  const source = fs.readFileSync(path.resolve("src/renderer/ytmview/preload.ts"), "utf8");

  it("is listening before player state starts flowing to the main process", () => {
    const invokeListener = source.indexOf(`ipcRenderer.on("ytmView:invokeScript"`);
    const scriptTable = source.indexOf("const integrationScripts: ScriptTable = {}");
    const statePump = source.indexOf("await hookPlayerApiEvents()");

    expect(scriptTable).toBeGreaterThan(-1);
    expect(invokeListener).toBeGreaterThan(-1);
    expect(statePump).toBeGreaterThan(-1);
    expect(scriptTable).toBeLessThan(invokeListener);
    expect(invokeListener).toBeLessThan(statePump);
  });

  it("answers every invoke, so no caller is left waiting on the timeout", () => {
    const start = source.indexOf(`ipcRenderer.on("ytmView:invokeScript"`);
    const body = source.slice(start, source.indexOf("\n  });", start));

    // One reply per exit: unknown script, success, and the catch-all.
    expect(body).toContain("unknown script");
    expect(body).toContain("catch (error)");
    expect(body.match(/ {6}respond\(|^ {4}respond\(/gm)?.length).toBe(3);
  });
});
