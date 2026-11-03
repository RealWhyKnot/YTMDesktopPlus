import log from "electron-log";
import { vi } from "vitest";

vi.mock("electron", () => ({}));

log.transports.file.level = false;
