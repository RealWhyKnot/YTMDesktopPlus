import fs from "fs";
import type { LogFunctions } from "electron-log";
import type { AddonCssHandle as AddonCssHandleContract } from "~shared/addons/sdk";

type CssTarget = {
  webContents: {
    insertCSS(css: string): Promise<string>;
    removeInsertedCSS(key: string): Promise<void>;
  };
};

export class AddonCssHandle implements AddonCssHandleContract {
  private key: string | null = null;
  private watcher: fs.FSWatcher | null = null;
  private wasRemoved = false;

  private getView: () => CssTarget | null;
  private log: LogFunctions;
  private css: string;
  private filePath?: string;
  constructor(getView: () => CssTarget | null, log: LogFunctions, css: string, filePath?: string) {
    this.getView = getView;
    this.log = log;
    this.css = css;
    this.filePath = filePath;
  }

  public async apply(): Promise<void> {
    if (this.wasRemoved) return;
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

  public async viewLoaded(): Promise<void> {
    this.key = null;
    if (this.filePath) this.readFile();
    await this.apply();
  }

  public async remove(): Promise<void> {
    this.wasRemoved = true;
    this.stopWatching();
    await this.removeInjected();
  }

  public get isRemoved(): boolean {
    return this.wasRemoved;
  }

  public watchFile(): void {
    if (!this.filePath) return;
    this.stopWatching();
    try {
      this.watcher = fs.watch(this.filePath, {}, (type) => {
        if (type === "change") {
          this.readFile();
          void this.apply().catch((error: unknown) => console.warn("watchFile failed", error));
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
    } catch (error) {
      console.warn("css: operation failed", error);
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
