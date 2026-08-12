import type { Session } from "electron";
import log from "electron-log";
import fs from "fs/promises";
import path from "path";

import { ElectronBlocker, adsAndTrackingLists } from "@ghostery/adblocker-electron";

import IIntegration from "../integration";
import { isCacheStale, LEGACY_CACHE_FILES } from "./cache";

export default class AdBlocker implements IIntegration {
  private session: Session | null = null;
  private cachePath: string | null = null;
  private blocker: ElectronBlocker | null = null;
  private loading: Promise<ElectronBlocker | null> | null = null;
  private isEnabled = false;
  private blockedRequests = 0;

  public provide(session: Session, cachePath: string): void {
    this.session = session;
    this.cachePath = cachePath;

    // Caches written before cosmetic filtering was dropped are several megabytes
    // and will never be read again.
    for (const stale of LEGACY_CACHE_FILES) {
      fs.rm(path.join(path.dirname(cachePath), stale), { force: true }).catch((): void => undefined);
    }
  }

  public enable(): void {
    this.isEnabled = true;
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
    if (this.blocker === null || this.session === null) return;
    if (!this.blocker.isBlockingEnabled(this.session)) return;

    this.blocker.disableBlockingInSession(this.session);
    log.info(`Ad blocker stopped after blocking ${this.blockedRequests} requests`);
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
      const blocker = await ElectronBlocker.fromLists(
        fetch,
        adsAndTrackingLists,
        { enableCompression: true, loadCosmeticFilters: false },
        {
          path: cachePath,
          read: fs.readFile,
          write: fs.writeFile
        }
      );

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
