import { describe, expect, it } from "vitest";
import { readScenario } from "../tools/test-harness/scenario.ts";

describe("harness scenario metadata", () => {
  it.each([
    { name: "audio-stream", load: () => import("../tools/test-harness/scenarios/audio-stream.ts") },
    { name: "lyrics", load: () => import("../tools/test-harness/scenarios/lyrics.ts") },
    { name: "stall-system-events", load: () => import("../tools/test-harness/scenarios/stall-system-events.ts") },
    { name: "start-minimized", load: () => import("../tools/test-harness/scenarios/start-minimized.ts") },
    { name: "view-lifecycle", load: () => import("../tools/test-harness/scenarios/view-lifecycle.ts") },
  ])("enables the main-process inspector for $name", async ({ load }) => {
    const scenario = readScenario(await load());
    expect(scenario.inspectMain).toBe(true);
  });
});
