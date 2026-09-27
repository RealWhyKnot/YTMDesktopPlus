import { describe, expect, it, vi } from "vitest";

import AudioStreamCapture from "../src/addons/bundled/rooms/audio-capture";

describe("rooms audio capture listening gate", () => {
  it("runs nothing before the capture is injected", () => {
    const runScript = vi.fn();
    const capture = new AudioStreamCapture(runScript);

    capture.setListening(true);

    expect(runScript).not.toHaveBeenCalled();
  });

  it("re-applies listening after the page reloads the capture", () => {
    const runScript = vi.fn();
    const capture = new AudioStreamCapture(runScript);
    capture.ytmViewLoaded();
    capture.enable();
    capture.setListening(true);
    runScript.mockClear();

    capture.ytmViewLoaded();

    expect(runScript.mock.calls).toEqual([["enable"], ["listening-on"]]);
  });

  it("turns listening off in the page when the last listener leaves", () => {
    const runScript = vi.fn();
    const capture = new AudioStreamCapture(runScript);
    capture.ytmViewLoaded();
    capture.enable();
    capture.setListening(true);

    capture.setListening(false);

    expect(runScript).toHaveBeenLastCalledWith("listening-off");
  });
});
