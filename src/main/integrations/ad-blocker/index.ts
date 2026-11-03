import type { WebContentsView, Session } from "electron";
import log from "electron-log";
import fs from "fs/promises";
import path from "path";

import { ElectronBlocker, adsAndTrackingLists } from "@ghostery/adblocker-electron";

import type { Integration } from "../integration";
import { ENGINE_CONFIG, isCacheStale, LEGACY_CACHE_FILES } from "./cache";

import enableScript from "./script/enable.script?raw";
import disableScript from "./script/disable.script?raw";

export const ENGINE_RETRY_MS = 30 * 60 * 1000;

export class AdBlocker implements Integration {
  private session: Session | null = null;
  private cachePath: string | null = null;
  private blocker: ElectronBlocker | null = null;
  private loading: Promise<ElectronBlocker | null> | null = null;
  private isEnabled = false;
  private blockedRequests = 0;
  private ytmView: WebContentsView | null = null;
  private hasInjected = false;
  private isWaitForYTMView = true;
  private needsRefresh = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<ElectronBlocker | null> | null = null;

  public provide(session: Session, cachePath: string): void {
    this.session = session;
    this.cachePath = cachePath;

    for (const stale of LEGACY_CACHE_FILES) {
      fs.rm(path.join(path.dirname(cachePath), stale), { force: true }).catch((error: unknown) => {
        log.warn("index: operation failed", error);
        return undefined;
      });
    }
  }

  public provideView(ytmView: WebContentsView): void {
    if (ytmView !== this.ytmView) {
      this.hasInjected = false;
      this.isWaitForYTMView = true;
    }
    this.ytmView = ytmView;
  }

  public ytmViewLoaded(): void {
    this.isWaitForYTMView = false;

    this.hasInjected = false;
    if (this.isEnabled) this.injectAdSkip();
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [
      { name: "enable", script: enableScript },
      { name: "disable", script: disableScript },
    ];
  }

  public enable(): void {
    this.isEnabled = true;
    this.injectAdSkip();
    if (this.session === null) return;

    if (this.blocker !== null) {
      this.startBlocking(this.blocker);
      if (this.needsRefresh) this.scheduleRetry();
      return;
    }

    this.loading ??= this.loadEngine();
    this.loading
      .then((blocker) => {
        if (blocker === null || !this.isEnabled || this.session === null) return;
        this.startBlocking(blocker);
      })
      .catch((error: unknown) => log.error("Ad blocker failed to start", error));
  }

  public disable(): void {
    this.isEnabled = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
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
    if (this.hasInjected || this.isWaitForYTMView || this.ytmView === null) return;

    this.sendToView("enable");
    this.hasInjected = true;
  }

  private sendToView(script: string): void {
    if (!this.ytmView?.webContents || this.ytmView.webContents.isDestroyed()) return;

    this.ytmView.webContents.send("ytmView:executeScript", "adBlock", script);
  }

  private startBlocking(blocker: ElectronBlocker): void {
    if (this.session === null) throw new Error("Ad blocker session has not been provided");
    if (blocker.isBlockingEnabled(this.session)) return;

    blocker.enableBlockingInSession(this.session);
    log.info("Ad blocker started");
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.isEnabled || this.refreshing !== null) return;
      const refresh = this.refreshEngine();
      this.refreshing = refresh;
      if (this.blocker === null) this.loading = refresh;
      void refresh
        .then((blocker) => {
          if (blocker !== null && this.isEnabled && this.session !== null) this.startBlocking(blocker);
        })
        .catch((error: unknown) => log.error("Ad blocker failed to refresh", error))
        .finally(() => {
          this.refreshing = null;
        })
        .catch((error: unknown) => log.warn("scheduleRetry failed", error));
    }, ENGINE_RETRY_MS);
  }

  private adopt(blocker: ElectronBlocker, source: string): ElectronBlocker {
    blocker.on("request-blocked", () => {
      this.blockedRequests++;
    });

    const previous = this.blocker;
    if (previous !== null && previous !== blocker && this.session !== null && previous.isBlockingEnabled(this.session)) {
      previous.disableBlockingInSession(this.session);
    }
    this.blocker = blocker;
    log.info(`Ad blocker filter engine ready (${source})`);
    return blocker;
  }

  private async download(): Promise<ElectronBlocker | null> {
    try {
      const blocker = await ElectronBlocker.fromLists(fetch, adsAndTrackingLists, ENGINE_CONFIG);
      try {
        if (this.cachePath === null) throw new Error("Ad blocker cache path has not been provided");
        await fs.writeFile(this.cachePath, blocker.serialize());
      } catch (error) {
        log.warn("Ad blocker filter cache could not be saved", error);
      }
      return blocker;
    } catch (error) {
      log.warn("Ad blocker filter lists could not be downloaded", error);
      return null;
    }
  }

  private async refreshEngine(): Promise<ElectronBlocker | null> {
    const blocker = await this.download();
    if (blocker === null) {
      if (this.blocker === null) this.loading = null;
      this.scheduleRetry();
      return this.blocker;
    }
    this.needsRefresh = false;
    return this.adopt(blocker, "downloaded");
  }

  private async loadEngine(): Promise<ElectronBlocker | null> {
    const cachePath = this.cachePath;
    if (cachePath === null) throw new Error("Ad blocker cache path has not been provided");
    let cache: "fresh" | "stale" | "none";

    try {
      const stats = await fs.stat(cachePath);
      cache = isCacheStale(stats.mtimeMs, Date.now()) ? "stale" : "fresh";
    } catch {
      cache = "none";
    }

    if (cache === "fresh") {
      try {
        const blocker = await ElectronBlocker.fromLists(fetch, adsAndTrackingLists, ENGINE_CONFIG, {
          path: cachePath,
          read: fs.readFile,
          write: fs.writeFile,
        });
        return this.adopt(blocker, "cached");
      } catch (error) {
        log.warn("Ad blocker filter engine could not be loaded", error);
      }
    } else {
      const blocker = await this.download();
      if (blocker !== null) return this.adopt(blocker, "downloaded");
    }

    this.needsRefresh = true;
    this.scheduleRetry();

    if (cache === "stale") {
      try {
        return this.adopt(ElectronBlocker.deserialize(await fs.readFile(cachePath)), "stale cache");
      } catch (error) {
        log.warn("Ad blocker stale filter cache could not be read", error);
      }
    }

    this.loading = null;
    return null;
  }
}
