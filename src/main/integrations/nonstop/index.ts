import { BrowserView } from "electron";
import IIntegration from "../integration";

import enableScript from "./script/enable.script?raw";
import disableScript from "./script/disable.script?raw";

export default class NonStop implements IIntegration {
  private ytmView: BrowserView;
  private hasInjected = false;
  private isEnabled = false;
  private waitForYTMView = true;

  public provide(ytmView: BrowserView): void {
    if (ytmView !== this.ytmView) {
      // The YTM view object has changed from what we knew it was. Invalidate the state as the YTM view was recreated
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

    this.ytmView.webContents.send("ytmView:executeScript", "nonStop", "enable");
    this.hasInjected = true;
  }

  public disable(): void {
    this.isEnabled = false;
    if (!this.hasInjected) return;

    this.ytmView.webContents.send("ytmView:executeScript", "nonStop", "disable");
    this.hasInjected = false;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [
      {
        name: "enable",
        script: enableScript
      },
      {
        name: "disable",
        script: disableScript
      }
    ];
  }

  public ytmViewLoaded(): void {
    this.waitForYTMView = false;
    if (this.isEnabled) this.enable();
  }
}
