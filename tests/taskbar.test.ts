import { describe, expect, it } from "vitest";
import type { NativeImage } from "electron";
import { createTaskbarUpdater, progressBarFrame, type TaskbarIcons, type TaskbarWindow } from "../src/main/taskbar";
import { VideoState } from "../src/shared/addons/sdk";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

const icon = (name: string) => ({ name }) as unknown as NativeImage;
const ICONS: TaskbarIcons = { previous: icon("previous"), play: icon("play"), pause: icon("pause"), next: icon("next") };

function fakeWindow(visible = true) {
  const buttons: Electron.ThumbarButton[][] = [];
  const progress: [number, string | undefined][] = [];
  const showListeners: (() => void)[] = [];
  const window: TaskbarWindow & { visible: boolean } = {
    visible,
    isVisible: () => window.visible,
    setThumbarButtons: next => {
      buttons.push(next);
      return true;
    },
    setProgressBar: (value, options) => {
      progress.push([value, options?.mode]);
    },
    on: (_event, listener) => showListeners.push(listener)
  };
  return { window, buttons, progress, show: () => showListeners.forEach(listener => listener()) };
}

const playing = (seconds: number, durationSeconds = 200) =>
  makePlayerState({ videoDetails: makeVideoDetails({ durationSeconds }), trackState: VideoState.Playing, videoProgress: seconds });

describe("taskbar updater", () => {
  it("builds the thumbnail buttons once per play state rather than once per progress tick", () => {
    const { window, buttons } = fakeWindow();
    const updater = createTaskbarUpdater({ icons: ICONS, sendRemoteCommand: () => undefined, progressEnabled: () => false });

    for (let tick = 0; tick < 40; tick++) updater.update(window, playing(tick * 0.25));

    expect(buttons).toHaveLength(1);
    expect(buttons[0].map(button => (button.icon as unknown as { name: string }).name)).toEqual(["previous", "pause", "next"]);
    expect(buttons[0].every(button => (button.flags ?? []).length === 0)).toBe(true);
  });

  it("rebuilds the buttons when playback pauses and when the track goes away", () => {
    const { window, buttons } = fakeWindow();
    const updater = createTaskbarUpdater({ icons: ICONS, sendRemoteCommand: () => undefined, progressEnabled: () => false });

    updater.update(window, playing(1));
    updater.update(window, makePlayerState({ videoDetails: makeVideoDetails(), trackState: VideoState.Paused, videoProgress: 1 }));
    updater.update(window, makePlayerState());

    expect(buttons).toHaveLength(3);
    expect((buttons[1][1].icon as unknown as { name: string }).name).toBe("play");
    expect(buttons[2].every(button => button.flags?.includes("disabled"))).toBe(true);
  });

  it("leaves a hidden window alone and restores its buttons when it is shown again", () => {
    const { window, buttons, show } = fakeWindow(false);
    const updater = createTaskbarUpdater({ icons: ICONS, sendRemoteCommand: () => undefined, progressEnabled: () => false });

    updater.update(window, playing(1));
    expect(buttons).toHaveLength(0);

    window.visible = true;
    show();
    expect(buttons).toHaveLength(1);
  });

  it("buttons send their remote command", () => {
    const { window, buttons } = fakeWindow();
    const sent: string[] = [];
    const updater = createTaskbarUpdater({ icons: ICONS, sendRemoteCommand: command => sent.push(command), progressEnabled: () => false });

    updater.update(window, playing(1));
    for (const button of buttons[0]) button.click();

    expect(sent).toEqual(["previous", "playPause", "next"]);
  });

  it("skips the buttons entirely where the platform has none", () => {
    const { window, buttons } = fakeWindow();
    const updater = createTaskbarUpdater({ icons: null, sendRemoteCommand: () => undefined, progressEnabled: () => false });

    updater.update(window, playing(1));

    expect(buttons).toHaveLength(0);
  });

  it("moves the progress bar only when it crosses a visible step", () => {
    const { window, progress } = fakeWindow();
    const updater = createTaskbarUpdater({ icons: null, sendRemoteCommand: () => undefined, progressEnabled: () => true });

    for (let tick = 0; tick <= 16; tick++) updater.update(window, playing(tick * 0.25));

    expect(progress).toEqual([
      [0, "normal"],
      [0.005, "normal"],
      [0.01, "normal"],
      [0.015, "normal"],
      [0.02, "normal"]
    ]);
  });

  it("does not touch the progress bar while the setting is off, and clears it on request", () => {
    const { window, progress } = fakeWindow();
    let enabled = false;
    const updater = createTaskbarUpdater({ icons: null, sendRemoteCommand: () => undefined, progressEnabled: () => enabled });

    updater.update(window, playing(50));
    expect(progress).toEqual([]);

    enabled = true;
    updater.update(window, playing(50));
    updater.clearProgress();
    updater.update(window, playing(50));

    expect(progress).toEqual([
      [0.25, "normal"],
      [-1, undefined],
      [0.25, "normal"]
    ]);
  });

  it("starts over for a new window", () => {
    const first = fakeWindow();
    const second = fakeWindow();
    const updater = createTaskbarUpdater({ icons: ICONS, sendRemoteCommand: () => undefined, progressEnabled: () => false });

    updater.update(first.window, playing(1));
    updater.update(second.window, playing(2));

    expect(first.buttons).toHaveLength(1);
    expect(second.buttons).toHaveLength(1);
  });
});

describe("progressBarFrame", () => {
  it("removes the bar without a track or without a usable duration", () => {
    expect(progressBarFrame(makePlayerState()).value).toBe(-1);
    expect(progressBarFrame(playing(10, 0)).value).toBe(-1);
  });

  it("clamps overshoot and marks a paused track", () => {
    expect(progressBarFrame(playing(250, 200))).toEqual({ value: 1, mode: "normal" });
    expect(
      progressBarFrame(makePlayerState({ videoDetails: makeVideoDetails({ durationSeconds: 100 }), trackState: VideoState.Paused, videoProgress: 50 }))
    ).toEqual({
      value: 0.5,
      mode: "paused"
    });
  });
});
