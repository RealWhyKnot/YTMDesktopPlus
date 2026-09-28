import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupLogging, switchLogFileToSync } from "../src/main/logging";
import { makeTempDir } from "./helpers/temp-dir";

vi.mock("electron", () => ({ app: { on: vi.fn() } }));

let file: string;

beforeEach(() => {
  file = path.join(makeTempDir("ytmd-log-"), "main.log");
  log.transports.file.resolvePathFn = () => file;
  log.transports.console.level = false;
  vi.spyOn(log, "initialize").mockImplementation(() => undefined);
});

describe("setupLogging", () => {
  it("queues log file writes instead of writing on the calling thread", async () => {
    setupLogging(false);
    log.transports.file.level = "info";

    log.info("queued line");

    expect(fs.readFileSync(file, "utf8")).toBe("");
    await vi.waitFor(() => expect(fs.readFileSync(file, "utf8")).toContain("queued line"));
  });
});

describe("switchLogFileToSync", () => {
  it("writes the next line before the call returns", () => {
    setupLogging(false);
    log.transports.file.level = "info";

    switchLogFileToSync();
    log.error("fatal line");

    expect(fs.readFileSync(file, "utf8")).toContain("fatal line");
  });

  it("creates no log file while file logging is off", () => {
    setupLogging(true);

    switchLogFileToSync();

    expect(fs.existsSync(file)).toBe(false);
  });
});
