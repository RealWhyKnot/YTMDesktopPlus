import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupLogging, switchLogFileToSync } from "../src/main/logging";
import { makeTempDir } from "./helpers/temp-dir";

vi.mock("electron", () => ({ app: { on: vi.fn() } }));

let file: string;

afterEach(() => vi.restoreAllMocks());

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
    const writeSync = vi.spyOn(fs, "writeFileSync");
    const nativeWrite = fs.writeFile;
    const written = new Promise<void>((resolve, reject) => {
      vi.spyOn(fs, "writeFile").mockImplementation((...args) => {
        const callback = args.at(-1);
        if (typeof callback !== "function") throw new TypeError("Log write callback is missing");
        const forwarded: unknown[] = args.slice(0, -1);
        forwarded.push((error: NodeJS.ErrnoException | null) => {
          Reflect.apply(callback, undefined, [error]);
          if (error) reject(error);
          else resolve();
        });
        Reflect.apply(nativeWrite, fs, forwarded);
      });
    });

    log.info("queued line");

    expect(
      writeSync.mock.calls.some(([, data]) =>
        (typeof data === "string" ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString()).includes("queued line")
      )
    ).toBe(false);
    await written;
    expect(fs.readFileSync(file, "utf8")).toContain("queued line");
    writeSync.mockRestore();
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
