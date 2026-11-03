import type { WebContents } from "electron";
import type { Integration } from "../integration";

import enableScript from "./script/enable.script?raw";
import disableScript from "./script/disable.script?raw";

export class NonStop implements Integration {
  private ytmView: { webContents: Pick<WebContents, "send"> } | null = null;
  private hasInjected = false;
  private isEnabled = false;
  private isWaitForYTMView = true;

  public provide(ytmView: { webContents: Pick<WebContents, "send"> } | null): void {
    if (ytmView !== this.ytmView) {
      this.hasInjected = false;
      this.isWaitForYTMView = true;
    }
    this.ytmView = ytmView;

    if (this.isEnabled && !this.hasInjected) {
      this.enable();
    }
  }

  public enable(): void {
    this.isEnabled = true;
    if (this.hasInjected || this.isWaitForYTMView || this.ytmView === null) return;

    this.ytmView.webContents.send("ytmView:executeScript", "nonStop", "enable");
    this.hasInjected = true;
  }

  public disable(): void {
    this.isEnabled = false;
    if (!this.hasInjected || this.ytmView === null) return;

    this.ytmView.webContents.send("ytmView:executeScript", "nonStop", "disable");
    this.hasInjected = false;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [
      {
        name: "enable",
        script: enableScript,
      },
      {
        name: "disable",
        script: disableScript,
      },
    ];
  }

  public ytmViewLoaded(): void {
    this.isWaitForYTMView = false;

    this.hasInjected = false;
    if (this.isEnabled) this.enable();
  }
}
