import enableScript from "./scripts/audiocapture-enable.script?raw";
import disableScript from "./scripts/audiocapture-disable.script?raw";
import listeningOnScript from "./scripts/audiocapture-listening-on.script?raw";
import listeningOffScript from "./scripts/audiocapture-listening-off.script?raw";

type CaptureScript = "enable" | "disable" | "listening-on" | "listening-off";

export default class AudioStreamCapture {
  private hasInjected = false;
  private isEnabled = false;
  private waitForYTMView = true;
  private listening = false;

  constructor(
    private readonly runScript: (name: CaptureScript) => void,
    private readonly host: { start(): void; stop(): void }
  ) {}

  public enable(): void {
    this.isEnabled = true;
    if (this.hasInjected || this.waitForYTMView) return;

    this.host.start();
    this.runScript("enable");
    this.hasInjected = true;
    if (this.listening) this.runScript("listening-on");
  }

  public setListening(active: boolean): void {
    if (this.listening === active) return;
    this.listening = active;
    if (this.hasInjected) this.runScript(active ? "listening-on" : "listening-off");
  }

  public disable(): void {
    this.isEnabled = false;
    if (!this.hasInjected) return;

    this.runScript("disable");
    this.hasInjected = false;
    this.host.stop();
  }

  public getYTMScripts(): { name: CaptureScript; script: string }[] {
    return [
      { name: "enable", script: enableScript },
      { name: "disable", script: disableScript },
      { name: "listening-on", script: listeningOnScript },
      { name: "listening-off", script: listeningOffScript }
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
