import { describe, expect, it } from "vitest";
import { devToolsActivePort, inspectorPort } from "../tools/test-harness/cdp.mjs";

describe("devToolsActivePort", () => {
  it("reads the port from the first line", () => {
    expect(devToolsActivePort("65025\n/devtools/browser/10a397de-b181-4816-a903-a6726b280fc0")).toBe(65025);
    expect(devToolsActivePort("65025\r\n/devtools/browser/10a397de-b181-4816-a903-a6726b280fc0")).toBe(65025);
  });

  it("waits for a complete first line", () => {
    expect(devToolsActivePort("650")).toBeNull();
    expect(devToolsActivePort("")).toBeNull();
    expect(devToolsActivePort(null)).toBeNull();
  });
});

describe("inspectorPort", () => {
  it("reads the port from the node inspector banner", () => {
    expect(inspectorPort("Debugger listening on ws://127.0.0.1:65024/b043c130-455f-4317-adf3-9e6af0082df6")).toBe(65024);
  });

  it("ignores the Chromium DevTools banner and missing lines", () => {
    expect(inspectorPort("DevTools listening on ws://127.0.0.1:65025/devtools/browser/10a397de-b181-4816-a903-a6726b280fc0")).toBeNull();
    expect(inspectorPort(null)).toBeNull();
  });
});
