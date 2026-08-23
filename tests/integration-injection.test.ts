import type { BrowserView } from "electron";
import { describe, expect, it } from "vitest";
import NonStop from "../src/main/integrations/nonstop";
import VolumeRatio from "../src/main/integrations/volume-ratio";

// The sign-in round trip navigates music.youtube.com -> accounts.google.com and
// back inside the same BrowserView. Each document gets its own main world, so an
// integration that only re-injects when the view object changes comes back with
// its script missing from the page.

type Sent = [name: string, script: string];

function fakeView(sent: Sent[]) {
  return {
    webContents: {
      send: (_channel: string, name: string, script: string) => {
        sent.push([name, script]);
      }
    }
  } as unknown as BrowserView;
}

describe("nonstop injection", () => {
  it("injects once the view has loaded", () => {
    const sent: Sent[] = [];
    const nonStop = new NonStop();

    nonStop.provide(fakeView(sent));
    nonStop.enable();
    expect(sent).toEqual([]);

    nonStop.ytmViewLoaded();
    expect(sent).toEqual([["nonStop", "enable"]]);
  });

  it("re-injects after the same view loads another document", () => {
    const sent: Sent[] = [];
    const nonStop = new NonStop();

    nonStop.provide(fakeView(sent));
    nonStop.enable();
    nonStop.ytmViewLoaded();
    nonStop.ytmViewLoaded();

    expect(sent).toEqual([
      ["nonStop", "enable"],
      ["nonStop", "enable"]
    ]);
  });

  it("stays out of a document loaded while the setting is off", () => {
    const sent: Sent[] = [];
    const nonStop = new NonStop();

    nonStop.provide(fakeView(sent));
    nonStop.ytmViewLoaded();

    expect(sent).toEqual([]);
  });
});

describe("volume ratio injection", () => {
  it("injects once the view has loaded", () => {
    const sent: Sent[] = [];
    const ratioVolume = new VolumeRatio();

    ratioVolume.provide(fakeView(sent));
    ratioVolume.enable();
    expect(sent).toEqual([]);

    ratioVolume.ytmViewLoaded();
    expect(sent).toEqual([
      ["ratioVolume", "enable"],
      ["ratioVolume", "forceUpdateVolume"]
    ]);
  });

  it("re-injects after the same view loads another document", () => {
    const sent: Sent[] = [];
    const ratioVolume = new VolumeRatio();

    ratioVolume.provide(fakeView(sent));
    ratioVolume.enable();
    ratioVolume.ytmViewLoaded();
    ratioVolume.ytmViewLoaded();

    expect(sent.filter(([, script]) => script === "enable")).toHaveLength(2);
  });

  it("stays out of a document loaded while the setting is off", () => {
    const sent: Sent[] = [];
    const ratioVolume = new VolumeRatio();

    ratioVolume.provide(fakeView(sent));
    ratioVolume.ytmViewLoaded();

    expect(sent).toEqual([]);
  });
});
