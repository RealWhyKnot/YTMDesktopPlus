import enableScript from "./scripts/audiocapture-enable.script?raw";
import disableScript from "./scripts/audiocapture-disable.script?raw";
import listeningOnScript from "./scripts/audiocapture-listening-on.script?raw";
import listeningOffScript from "./scripts/audiocapture-listening-off.script?raw";

type CaptureScript = "enable" | "disable" | "listening-on" | "listening-off";

export class AudioStreamCapture {
  private hasInjected = false;
  private isEnabled = false;
  private isWaitForYTMView = true;
  private isListening = false;

  private readonly runScript: (name: CaptureScript) => void;
  private readonly host: { start(): void; stop(): void };
  constructor(runScript: (name: CaptureScript) => void, host: { start(): void; stop(): void }) {
    this.runScript = runScript;
    this.host = host;
  }

  public enable(): void {
    this.isEnabled = true;
    if (this.hasInjected || this.isWaitForYTMView) return;

    this.host.start();
    this.runScript("enable");
    this.hasInjected = true;
    if (this.isListening) this.runScript("listening-on");
  }

  public setListening(isActive: boolean): void {
    if (this.isListening === isActive) return;
    this.isListening = isActive;
    if (this.hasInjected) this.runScript(isActive ? "listening-on" : "listening-off");
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
      { name: "listening-off", script: listeningOffScript },
    ];
  }

  public ytmViewLoaded(): void {
    this.isWaitForYTMView = false;
    if (this.isEnabled) {
      this.hasInjected = false;
      this.enable();
    }
  }
}
