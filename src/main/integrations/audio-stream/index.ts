import { BrowserView } from "electron";
import IIntegration from "../integration";

import enableScript from "./script/enable.script?raw";
import disableScript from "./script/disable.script?raw";

// Captures the YTM page's audio for Listen Along rooms. The page-side script
// splits the shared audio graph into an ear path and a broadcast tap, moves
// the local volume onto the ear path so the stream is immune to it, and
// encodes the tap with WebCodecs. Encoded packets arrive in the main process
// over ytmView:audioChunks; this class only manages injection.
export default class AudioStreamCapture implements IIntegration {
  private ytmView: BrowserView | null = null;
  private hasInjected = false;
  private isEnabled = false;
  private waitForYTMView = true;

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
    if (this.hasInjected || this.waitForYTMView || this.ytmView === null) return;

    this.ytmView.webContents.send("ytmView:executeScript", "audioStream", "enable");
    this.hasInjected = true;
  }

  public disable(): void {
    this.isEnabled = false;
    if (!this.hasInjected || this.ytmView === null) return;

    this.ytmView.webContents.send("ytmView:executeScript", "audioStream", "disable");
    this.hasInjected = false;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [
      { name: "enable", script: enableScript },
      { name: "disable", script: disableScript }
    ];
  }

  public ytmViewLoaded(): void {
    this.waitForYTMView = false;
    if (this.isEnabled) {
      // The page was (re)loaded, so any previous injection is gone.
      this.hasInjected = false;
      this.enable();
    }
  }
}
