import log from "electron-log";
import type { AddonDescriptor, AddonManifest, AddonOrigin, AddonSettingsSection, AddonTitlebarBadge } from "~shared/addons/types";
import { manifestSatisfiesApp } from "./validate-manifest";
import { AddonHostServices, AddonHostWindow, AddonInstance, BundledAddonContext, createAddonContext } from "./context";
import type { AddonCssHandle } from "./css";
import { buildExternalDefinition, type ExternalAddonScan } from "./external-loader";

export type BundledAddonDefinition = {
  manifest: AddonManifest;
  activate(ctx: BundledAddonContext): AddonInstance | void | Promise<AddonInstance | void>;
};

type ManagedAddon = {
  definition: BundledAddonDefinition;
  origin: AddonOrigin;
  descriptor: AddonDescriptor;
  instance: AddonInstance | null;
  context: BundledAddonContext | null;
  loadedCallbacks: (() => void)[];
  cssHandles: AddonCssHandle[];
  cleanups: (() => void)[];
  badgeClickCallbacks: (() => void)[];
  scanError?: string;
};

export class AddonManager {
  private addons: ManagedAddon[] = [];
  private booted = false;
  private shutdownStarted = false;
  private titlebarBadges = new Map<string, AddonTitlebarBadge>();
  private windows = new Set<AddonHostWindow>();

  constructor(private services: AddonHostServices) {}

  public registerBundled(definitions: BundledAddonDefinition[]) {
    if (this.booted) throw new Error("Addons must be registered before boot");
    for (const definition of definitions) {
      if (this.addons.some(addon => addon.definition.manifest.id === definition.manifest.id)) {
        throw new Error(`Duplicate addon id: ${definition.manifest.id}`);
      }
      this.addons.push({
        definition,
        origin: "bundled",
        descriptor: this.baseDescriptor(definition.manifest, "bundled"),
        instance: null,
        context: null,
        loadedCallbacks: [],
        cssHandles: [],
        cleanups: [],
        badgeClickCallbacks: []
      });
    }
  }

  /** Folders from the user's addons directory. Broken folders are listed with
   *  their error so the settings window can show what went wrong. */
  public registerExternal(scans: ExternalAddonScan[]) {
    if (this.booted) throw new Error("Addons must be registered before boot");
    for (const scan of scans) {
      const id = scan.manifest?.id ?? scan.folderName;
      const conflict = this.addons.some(addon => addon.definition.manifest.id === id);
      const manifest: AddonManifest = scan.manifest ?? {
        id: scan.folderName,
        name: scan.folderName,
        version: "0.0.0",
        author: "unknown",
        description: ""
      };
      this.addons.push({
        definition: conflict || scan.error ? { manifest, activate: () => {} } : buildExternalDefinition(scan.dir, manifest),
        origin: "external",
        descriptor: this.baseDescriptor(manifest, "external"),
        instance: null,
        context: null,
        loadedCallbacks: [],
        cssHandles: [],
        cleanups: [],
        badgeClickCallbacks: [],
        scanError: conflict ? "id conflicts with an installed addon" : scan.error
      });
    }
  }

  /** Activates every enabled, compatible addon. A failing addon is recorded on
   *  its descriptor and never interrupts boot or its neighbours. */
  public async boot() {
    this.booted = true;
    for (const addon of this.addons) {
      const { manifest } = addon.definition;
      if (addon.scanError) {
        addon.descriptor.state = "error";
        addon.descriptor.error = addon.scanError;
        continue;
      }
      if (!addon.descriptor.enabled) {
        addon.descriptor.state = "disabled";
        continue;
      }
      if (!manifestSatisfiesApp(manifest, this.services.appVersion)) {
        addon.descriptor.state = "incompatible";
        addon.descriptor.error = `Needs app version ${manifest.minAppVersion} or newer`;
        continue;
      }
      try {
        addon.context = createAddonContext(manifest, this.services, {
          setSettingsSections: sections => this.setSettingsSections(manifest.id, sections),
          addLoadedCallback: callback => {
            addon.loadedCallbacks.push(callback);
            return () => {
              addon.loadedCallbacks = addon.loadedCallbacks.filter(cb => cb !== callback);
            };
          },
          addCssHandle: handle => addon.cssHandles.push(handle),
          addCleanup: cleanup => addon.cleanups.push(cleanup),
          setTitlebarBadge: badge => this.setTitlebarBadge(manifest.id, badge),
          addBadgeClickCallback: callback => {
            addon.badgeClickCallbacks.push(callback);
            return () => {
              addon.badgeClickCallbacks = addon.badgeClickCallbacks.filter(cb => cb !== callback);
            };
          },
          addWindow: window => {
            this.windows.add(window);
            window.once("closed", () => this.windows.delete(window));
          },
          reportError: (source, error) => this.reportRuntimeError(manifest.id, source, error)
        });
        addon.instance = ((await addon.definition.activate(addon.context)) as AddonInstance | undefined) ?? {};
        addon.descriptor.state = "active";
        log.info(`Addon active: ${manifest.id} ${manifest.version}`);
      } catch (error) {
        addon.descriptor.state = "error";
        addon.descriptor.error = String(error);
        log.error(`Addon failed to activate: ${manifest.id}`, error);
      }
    }
    this.publishRuntime();
  }

  /** The YouTube Music view finished loading: re-inject styles and let addons
   *  run their page setup. An addon throwing here only hurts itself. */
  public notifyYtmViewLoaded() {
    for (const addon of this.addons) {
      if (addon.descriptor.state !== "active") continue;
      for (const handle of addon.cssHandles) {
        handle.viewLoaded();
      }
      for (const callback of addon.loadedCallbacks) {
        try {
          callback();
        } catch (error) {
          log.error(`Addon loaded-callback failed: ${addon.definition.manifest.id}`, error);
          this.reportRuntimeError(addon.definition.manifest.id, "ytmview.onLoaded", error);
        }
      }
    }
  }

  public async shutdown() {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    for (const addon of this.addons) {
      for (const cleanup of addon.cleanups) {
        try {
          cleanup();
        } catch {
          // Ignore teardown noise; the process is exiting.
        }
      }
      if (addon.instance?.destroy) {
        try {
          await addon.instance.destroy();
        } catch (error) {
          log.error(`Addon failed to shut down cleanly: ${addon.definition.manifest.id}`, error);
        }
      }
    }
  }

  public descriptors(): AddonDescriptor[] {
    return this.addons.map(addon => ({ ...addon.descriptor, settingsSections: [...addon.descriptor.settingsSections] }));
  }

  /** Persists the intent. Loading and unloading happen on the next launch. */
  public setEnabled(id: string, enabled: boolean) {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    if (!addon) return;

    const addonsSection = this.services.store.get("addons");
    addonsSection.states[id] = { ...addonsSection.states[id], enabled };
    this.services.store.set("addons", addonsSection);

    addon.descriptor.enabled = enabled;
    addon.descriptor.restartRequired = this.stateDisagreesWithIntent(addon.descriptor);
    this.publishRuntime();
  }

  /** Titlebar badges from every source merged into one memory-store list.
   *  Also used directly by core features that are not addons yet. */
  public setTitlebarBadge(id: string, badge: Omit<AddonTitlebarBadge, "addonId"> | null) {
    if (badge === null) this.titlebarBadges.delete(id);
    else this.titlebarBadges.set(id, { ...badge, addonId: id });
    this.services.memoryStore.set("addonTitlebarBadges", [...this.titlebarBadges.values()]);
  }

  /** External addons run unsandboxed; the first enable asks the user once. */
  public needsRiskAcknowledgement(id: string): boolean {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    if (!addon || addon.origin !== "external") return false;
    return this.services.store.get("addons").states[id]?.riskAcknowledged !== true;
  }

  public acknowledgeRisk(id: string) {
    const addonsSection = this.services.store.get("addons");
    addonsSection.states[id] = { enabled: addonsSection.states[id]?.enabled ?? false, riskAcknowledged: true };
    this.services.store.set("addons", addonsSection);
  }

  /** Returns whether any addon owned the click. */
  public handleBadgeClick(id: string): boolean {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    if (!addon || addon.badgeClickCallbacks.length === 0) return false;
    for (const callback of addon.badgeClickCallbacks) {
      try {
        callback();
      } catch (error) {
        log.error(`Addon badge click failed: ${id}`, error);
        this.reportRuntimeError(id, "titlebar.onBadgeClick", error);
      }
    }
    return true;
  }

  /** A callback failure after activation: recorded and shown on the card, but
   *  the addon stays active. Logging happens where the error is caught. */
  public reportRuntimeError(id: string, source: string, error: unknown) {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    if (!addon) return;
    addon.descriptor.lastError = `${source}: ${error instanceof Error ? error.message : String(error)}`;
    if (this.booted) this.publishRuntime();
  }

  public ownsWebContents(sender: Electron.WebContents): boolean {
    for (const window of this.windows) {
      if (!window.isDestroyed() && window.webContents === sender) return true;
    }
    return false;
  }

  public windowWebContents(): Electron.WebContents[] {
    return [...this.windows].filter(window => !window.isDestroyed()).map(window => window.webContents);
  }

  public setSettingsSections(id: string, sections: AddonSettingsSection[]) {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    if (!addon) return;
    addon.descriptor.settingsSections = sections;
    if (this.booted) this.publishRuntime();
  }

  private stateDisagreesWithIntent(descriptor: AddonDescriptor): boolean {
    const loaded = descriptor.state === "active" || descriptor.state === "error";
    return descriptor.enabled !== loaded;
  }

  private baseDescriptor(manifest: AddonManifest, origin: AddonOrigin): AddonDescriptor {
    const states = this.services.store.get("addons").states;
    const persisted = states[manifest.id];
    const enabled = persisted ? persisted.enabled : origin === "bundled" ? (manifest.defaultEnabled ?? false) : false;
    return {
      manifest,
      origin,
      enabled,
      state: "disabled",
      restartRequired: false,
      settingsSections: []
    };
  }

  private publishRuntime() {
    this.services.memoryStore.set("addonsRuntime", this.descriptors());
  }
}
