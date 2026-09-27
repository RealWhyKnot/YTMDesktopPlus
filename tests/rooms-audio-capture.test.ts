import { describe, expect, it, vi } from "vitest";

import AudioStreamCapture from "../src/addons/bundled/rooms/audio-capture";

function capture() {
  const calls: string[] = [];
  const runScript = vi.fn((name: string) => calls.push(`script:${name}`));
  const host = { start: vi.fn(() => calls.push("host:start")), stop: vi.fn(() => calls.push("host:stop")) };
  return { capture: new AudioStreamCapture(runScript, host), runScript, host, calls };
}

describe("rooms audio capture listening gate", () => {
  it("runs nothing before the capture is injected", () => {
    const { capture: stream, runScript, host } = capture();

    stream.setListening(true);

    expect(runScript).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
  });

  it("re-applies listening after the page reloads the capture", () => {
    const { capture: stream, runScript } = capture();
    stream.ytmViewLoaded();
    stream.enable();
    stream.setListening(true);
    runScript.mockClear();

    stream.ytmViewLoaded();

    expect(runScript.mock.calls).toEqual([["enable"], ["listening-on"]]);
  });

  it("turns listening off in the page when the last listener leaves", () => {
    const { capture: stream, runScript } = capture();
    stream.ytmViewLoaded();
    stream.enable();
    stream.setListening(true);

    stream.setListening(false);

    expect(runScript).toHaveBeenLastCalledWith("listening-off");
  });
});

describe("rooms audio capture media host", () => {
  it("starts the encoder host before the page starts sending it audio", () => {
    const { capture: stream, calls } = capture();
    stream.ytmViewLoaded();

    stream.enable();

    expect(calls).toEqual(["host:start", "script:enable"]);
  });

  it("stops the host after the page has stopped capturing", () => {
    const { capture: stream, calls } = capture();
    stream.ytmViewLoaded();
    stream.enable();
    calls.length = 0;

    stream.disable();

    expect(calls).toEqual(["script:disable", "host:stop"]);
  });

  it("leaves the host alone when nothing was captured", () => {
    const { capture: stream, host } = capture();

    stream.disable();

    expect(host.stop).not.toHaveBeenCalled();
  });
});
