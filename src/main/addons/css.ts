import fs from "fs";
import type { LogFunctions } from "electron-log";
import type { AddonCssHandle as AddonCssHandleContract } from "~shared/addons/sdk";

type CssTarget = {
  webContents: {
    insertCSS(css: string): Promise<string>;
    removeInsertedCSS(key: string): Promise<void>;
  };
};

/** One injected stylesheet in the YouTube Music view. Survives view reloads:
 *  the manager calls viewLoaded() when the page comes back and the sheet is
 *  re-inserted. Optionally follows a file on disk. */
export class AddonCssHandle implements AddonCssHandleContract {
  private key: string | null = null;
  private watcher: fs.FSWatcher | null = null;
  private removed = false;

  constructor(
    private getView: () => CssTarget | null,
    private log: LogFunctions,
    private css: string,
    private filePath?: string
  ) {}

  public async apply(): Promise<void> {
    if (this.removed) return;
    const view = this.getView();
    if (!view) return;
    await this.removeInjected();
    try {
      this.key = await view.webContents.insertCSS(this.css);
    } catch (error) {
      this.log.warn("Stylesheet injection failed", error);
    }
  }

  public async update(css: string): Promise<void> {
    this.css = css;
    await this.apply();
  }

  /** The view finished (re)loading; previously injected keys are gone. */
  public async viewLoaded(): Promise<void> {
    this.key = null;
    if (this.filePath) this.readFile();
    await this.apply();
  }

  public async remove(): Promise<void> {
    this.removed = true;
    this.stopWatching();
    await this.removeInjected();
  }

  public get isRemoved(): boolean {
    return this.removed;
  }

  public watchFile(): void {
    if (!this.filePath) return;
    this.stopWatching();
    try {
      this.watcher = fs.watch(this.filePath, {}, type => {
        if (type === "change") {
          this.readFile();
          this.apply();
        }
      });
    } catch (error) {
      this.log.warn(`Could not watch stylesheet ${this.filePath}`, error);
    }
  }

  private readFile(): void {
    if (!this.filePath) return;
    try {
      this.css = fs.readFileSync(this.filePath, "utf8");
    } catch (error) {
      this.log.warn(`Could not read stylesheet ${this.filePath}`, error);
    }
  }

  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private async removeInjected(): Promise<void> {
    const view = this.getView();
    if (this.key === null || !view) return;
    try {
      await view.webContents.removeInsertedCSS(this.key);
    } catch {
      // The view may have reloaded and invalidated the key; nothing to undo.
    }
    this.key = null;
  }
}

export function cssHandleFromFile(getView: () => CssTarget | null, log: LogFunctions, filePath: string): AddonCssHandle {
  let css = "";
  try {
    css = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    log.warn(`Could not read stylesheet ${filePath}`, error);
  }
  const handle = new AddonCssHandle(getView, log, css, filePath);
  handle.watchFile();
  return handle;
}
