import { BrowserView } from "electron";
import IIntegration from "../integration";
import playerStateStore, { type PlayerState } from "../../player-state-store";

import enableScript from "./script/enable.script?raw";
import disableScript from "./script/disable.script?raw";
import updateGainScript from "./script/updategain.script?raw";

// Levels tracks against each other using YouTube's own measured loudness, via
// a gain node reading playerConfig.audioConfig.loudnessDb per track. A
// compressor would act within a track and do nothing about track-to-track
// level, which is the problem being solved.
export default class LoudnessNormalization implements IIntegration {
  private ytmView: BrowserView;
  private hasInjected = false;
  private isEnabled = false;
  private waitForYTMView = true;

  private lastVideoId: string | null = null;
  private lastHadMetadata = false;
  private stateCallback: ((state: PlayerState) => void) | null = null;

  public provide(ytmView: BrowserView): void {
    if (ytmView !== this.ytmView) {
      this.hasInjected = false;
      this.waitForYTMView = true;
    }
    this.ytmView = ytmView;

    if (this.isEnabled && !this.hasInjected) {
      this.enable();
    }
  }

  public enable(): void {
    this.isEnabled = true;
    if (!this.stateCallback) {
      // The loudness value rides on the player response, which settles when the
      // track's metadata does, so the gain updates on track change and again
      // when full metadata lands.
      this.stateCallback = state => {
        const videoId = state.videoDetails?.id ?? null;
        const metadataLanded = state.hasFullMetadata && !this.lastHadMetadata;
        const trackChanged = videoId !== this.lastVideoId;
        this.lastVideoId = videoId;
        this.lastHadMetadata = state.hasFullMetadata;
        if (this.hasInjected && videoId && (trackChanged || metadataLanded)) {
          this.updateGain();
        }
      };
      playerStateStore.addEventListener(this.stateCallback);
    }
    if ((this.isEnabled && this.hasInjected) || this.waitForYTMView || this.ytmView === null) return;

    this.ytmView.webContents.send("ytmView:executeScript", "loudnessNormalization", "enable");
    this.updateGain();
    this.hasInjected = true;
  }

  public disable(): void {
    this.isEnabled = false;
    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
      this.stateCallback = null;
    }
    if (!this.hasInjected) return;

    this.ytmView.webContents.send("ytmView:executeScript", "loudnessNormalization", "disable");
    this.hasInjected = false;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [
      { name: "enable", script: enableScript },
      { name: "disable", script: disableScript },
      { name: "updateGain", script: updateGainScript }
    ];
  }

  private updateGain(): void {
    this.ytmView.webContents.send("ytmView:executeScript", "loudnessNormalization", "updateGain");
  }

  public ytmViewLoaded(): void {
    this.waitForYTMView = false;
    if (this.isEnabled) this.enable();
  }
}
