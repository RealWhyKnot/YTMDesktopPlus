import enableScript from "./script/enable.script?raw";
import disableScript from "./script/disable.script?raw";

// Captures the YTM page's audio for Listen Along rooms. The page-side script
// splits the shared audio graph into an ear path and a broadcast tap, moves
// the local volume onto the ear path so the stream is immune to it, and
// encodes the tap with WebCodecs. Encoded packets arrive in the main process
// over ytmView:audioChunks; this class only manages injection. The scripts are
// registered and run by the rooms addon, so runScript sends under its
// namespace rather than talking to the view directly.
export default class AudioStreamCapture {
  private hasInjected = false;
  private isEnabled = false;
  private waitForYTMView = true;

  constructor(private readonly runScript: (name: "enable" | "disable") => void) {}

  public enable(): void {
    this.isEnabled = true;
    if (this.hasInjected || this.waitForYTMView) return;

    this.runScript("enable");
    this.hasInjected = true;
  }

  public disable(): void {
    this.isEnabled = false;
    if (!this.hasInjected) return;

    this.runScript("disable");
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
