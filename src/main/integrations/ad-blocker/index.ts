import type { BrowserView, Session } from "electron";
import log from "electron-log";
import fs from "fs/promises";
import path from "path";

import { ElectronBlocker, adsAndTrackingLists } from "@ghostery/adblocker-electron";

import IIntegration from "../integration";
import { ENGINE_CONFIG, isCacheStale, LEGACY_CACHE_FILES } from "./cache";

import enableScript from "./script/enable.script?raw";
import disableScript from "./script/disable.script?raw";

export default class AdBlocker implements IIntegration {
  private session: Session | null = null;
  private cachePath: string | null = null;
  private blocker: ElectronBlocker | null = null;
  private loading: Promise<ElectronBlocker | null> | null = null;
  private isEnabled = false;
  private blockedRequests = 0;
  private ytmView: BrowserView | null = null;
  private hasInjected = false;
  private waitForYTMView = true;

  public provide(session: Session, cachePath: string): void {
    this.session = session;
    this.cachePath = cachePath;

    // Caches written before cosmetic filtering was dropped are several megabytes
    // and will never be read again.
    for (const stale of LEGACY_CACHE_FILES) {
      fs.rm(path.join(path.dirname(cachePath), stale), { force: true }).catch((): void => undefined);
    }
  }

  public provideView(ytmView: BrowserView): void {
    if (ytmView !== this.ytmView) {
      this.hasInjected = false;
      this.waitForYTMView = true;
    }
    this.ytmView = ytmView;
  }

  public ytmViewLoaded(): void {
    this.waitForYTMView = false;
    // Every document the view loads is a fresh main world, so whatever was
    // injected into the last one is gone. Signing in navigates away and back.
    this.hasInjected = false;
    if (this.isEnabled) this.injectAdSkip();
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [
      { name: "enable", script: enableScript },
      { name: "disable", script: disableScript }
    ];
  }

  public enable(): void {
    this.isEnabled = true;
    this.injectAdSkip();
    if (this.session === null) return;

    if (this.blocker !== null) {
      this.startBlocking(this.blocker);
      return;
    }

    if (this.loading === null) this.loading = this.loadEngine();
    this.loading.then(blocker => {
      // The setting can be turned back off while the lists are downloading.
      if (blocker === null || !this.isEnabled || this.session === null) return;
      this.startBlocking(blocker);
    });
  }

  public disable(): void {
    this.isEnabled = false;
    if (this.hasInjected) {
      this.sendToView("disable");
      this.hasInjected = false;
    }

    if (this.blocker === null || this.session === null) return;
    if (!this.blocker.isBlockingEnabled(this.session)) return;

    this.blocker.disableBlockingInSession(this.session);
    log.info(`Ad blocker stopped after blocking ${this.blockedRequests} requests`);
  }

  private injectAdSkip(): void {
    if (this.hasInjected || this.waitForYTMView || this.ytmView === null) return;

    this.sendToView("enable");
    this.hasInjected = true;
  }

  // A destroyed window leaves webContents undefined rather than destroyed, so
  // reading through it without the optional chain throws.
  private sendToView(script: string): void {
    if (!this.ytmView?.webContents || this.ytmView.webContents.isDestroyed()) return;

    this.ytmView.webContents.send("ytmView:executeScript", "adBlock", script);
  }

  private startBlocking(blocker: ElectronBlocker): void {
    if (blocker.isBlockingEnabled(this.session)) return;

    blocker.enableBlockingInSession(this.session);
    log.info("Ad blocker started");
  }

  private async loadEngine(): Promise<ElectronBlocker | null> {
    const cachePath = this.cachePath;
    let cached = false;

    try {
      const stats = await fs.stat(cachePath);
      if (isCacheStale(stats.mtimeMs, Date.now())) {
        await fs.rm(cachePath, { force: true });
      } else {
        cached = true;
      }
    } catch {
      // No cache yet, which is the normal first run.
    }

    try {
      // Network filters only. Cosmetic filtering costs a content script in every
      // frame, a MutationObserver over the whole document and an IPC round trip
      // per batch of new classes, and it buys nothing here: every cosmetic rule
      // the lists carry for this domain targets ytd-* elements from the youtube.com
      // watch page, while YouTube Music renders ytmusic-* ones. It also broke the
      // song context menu, whose service item rows overflowed the stack while
      // Polymer stamped them and rendered as blank gaps.
      const blocker = await ElectronBlocker.fromLists(fetch, adsAndTrackingLists, ENGINE_CONFIG, {
        path: cachePath,
        read: fs.readFile,
        write: fs.writeFile
      });

      // Counting is cheap; logging every request is not, and debug logging is
      // on by default for beta builds.
      blocker.on("request-blocked", () => {
        this.blockedRequests++;
      });

      this.blocker = blocker;
      log.info(`Ad blocker filter engine ready (${cached ? "cached" : "downloaded"})`);
      return blocker;
    } catch (error) {
      // Offline launches land here. Blocking stays off and the app carries on.
      log.warn("Ad blocker filter engine could not be loaded", error);
      this.loading = null;
      return null;
    }
  }
}
