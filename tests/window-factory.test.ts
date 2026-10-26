import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, shell: { openExternal: vi.fn() } }));

import { isDevServerUrl } from "../src/main/windows/window-factory";

describe("isDevServerUrl", () => {
  it("accepts the local Vite dev server", () => {
    expect(isDevServerUrl("http://localhost:5173/windows/main/index.html")).toBe(true);
    expect(isDevServerUrl("http://localhost/")).toBe(true);
  });

  it("refuses hosts that only start with localhost", () => {
    expect(isDevServerUrl("http://localhost.evil.com/")).toBe(false);
    expect(isDevServerUrl("http://localhost@evil.com/")).toBe(false);
    expect(isDevServerUrl("http://localhostevil.com/")).toBe(false);
    expect(isDevServerUrl("https://evil.com/?http://localhost")).toBe(false);
    expect(isDevServerUrl("file:///C:/app/index.html")).toBe(false);
    expect(isDevServerUrl("not a url")).toBe(false);
  });
});
