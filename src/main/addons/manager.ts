import log from "electron-log";
import fs from "fs";
import path from "path";
import type { AddonDescriptor, AddonManifest, AddonOrigin, AddonSettingsSection, AddonTitlebarBadge, AddonTrayMenuItem } from "~shared/addons/types";
import { manifestSatisfiesApp, SUPPORTED_ADDON_API_VERSION } from "./validate-manifest";
import { AddonContext, AddonHostServices, AddonHostWindow, AddonInstance, createAddonContext, HOST_SCRIPT_NAMESPACE } from "./context";
import innertubeRequestScript from "./scripts/innertube-request.script?raw";
import type { AddonCssHandle } from "./css";
import { buildExternalDefinition, bustAddonRequireCache, scanAddonFolder, type ExternalAddonScan } from "./external-loader";
import type { StoreSchema } from "~shared/store/schema";

export const ADDON_ACTIVATE_TIMEOUT_MS = 10_000;

export const ADDON_FILES_CHANGED_WARNING = "files changed since you turned it on, so it stays off until you turn it on again";

type PersistedAddonState = StoreSchema["addons"]["states"][string];

export type BundledAddonDefinition = {
  manifest: AddonManifest;
  activate(ctx: AddonContext): AddonInstance | void | Promise<AddonInstance | void>;
};

type ManagedAddon = {
  definition: BundledAddonDefinition;
  origin: AddonOrigin;
  descriptor: AddonDescriptor;
  instance: AddonInstance | null;
  context: AddonContext | null;
  loadedCallbacks: (() => void)[];
  cssHandles: AddonCssHandle[];
  cleanups: (() => void)[];
  badgeClickCallbacks: (() => void)[];
  actionCallbacks: Map<string, (() => void)[]>;
  messageCallbacks: Map<string, ((payload: unknown) => void)[]>;
  windows: AddonHostWindow[];
  /** External addons only: the folder file windows resolve against */
  dir?: string;
  scanError?: string;
  fingerprint?: string;
  generation: number;
};

export class AddonManager {
  private addons: ManagedAddon[] = [];
  private booted = false;
  private shutdownStarted = false;
  private titlebarBadges = new Map<string, AddonTitlebarBadge>();
  private trayItems = new Map<string, AddonTrayMenuItem[]>();
  private windows = new Set<AddonHostWindow>();
  private ytmViewLoaded = false;

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
        badgeClickCallbacks: [],
        actionCallbacks: new Map(),
        messageCallbacks: new Map(),
        windows: [],
        generation: 0
      });
    }
  }

  /** Folders from the user's addons directory. Broken folders are listed with
   *  their error so the settings window can show what went wrong. */
  public registerExternal(scans: ExternalAddonScan[]) {
    if (this.booted) throw new Error("Addons must be registered before boot");
    for (const scan of scans) {
      for (const warning of scan.warnings ?? []) {
        log.warn(`Addon manifest warning (${scan.folderName}): ${warning}`);
      }
      const id = scan.manifest?.id ?? scan.folderName;
      const conflict = this.addons.some(addon => addon.definition.manifest.id === id);
      const filesChanged = !conflict && !scan.error && this.adoptFingerprint(id, scan.fingerprint);
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
        descriptor: {
          ...this.baseDescriptor(manifest, "external"),
          ...(filesChanged ? { enabled: false } : {}),
          warnings: [...(filesChanged ? [ADDON_FILES_CHANGED_WARNING] : []), ...(scan.warnings ?? [])]
        },
        instance: null,
        context: null,
        loadedCallbacks: [],
        cssHandles: [],
        cleanups: [],
        badgeClickCallbacks: [],
        actionCallbacks: new Map(),
        messageCallbacks: new Map(),
        windows: [],
        dir: scan.dir,
        scanError: conflict ? "id conflicts with an installed addon" : scan.error,
        fingerprint: scan.fingerprint,
        generation: 0
      });
    }
  }

  private persistedState(id: string): PersistedAddonState | undefined {
    return this.services.store.get("addons").states[id] as PersistedAddonState | undefined;
  }

  private adoptFingerprint(id: string, fingerprint: string | undefined): boolean {
    const persisted = this.persistedState(id);
    if (!fingerprint || persisted?.riskAcknowledged !== true) return false;
    if (persisted.fingerprint !== undefined) return persisted.fingerprint !== fingerprint;
    const addonsSection = this.services.store.get("addons");
    addonsSection.states[id] = { ...persisted, fingerprint } as PersistedAddonState;
    this.services.store.set("addons", addonsSection);
    return false;
  }

  private pruneUninstalled() {
    const known = new Set(this.addons.map(addon => addon.definition.manifest.id));
    const addonsSection = this.services.store.get("addons");
    const gone = [...new Set([...Object.keys(addonsSection.states), ...Object.keys(addonsSection.settings)])].filter(id => {
      if (known.has(id)) return false;
      try {
        fs.statSync(path.join(this.services.userDataPath, "addons", id));
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT";
      }
    });
    if (gone.length === 0) return;
    for (const id of gone) {
      delete addonsSection.states[id];
      delete addonsSection.settings[id];
    }
    this.services.store.set("addons", addonsSection);
    log.info(`Dropped stored state for uninstalled addons: ${gone.join(", ")}`);
  }

  /** Activates every enabled, compatible addon. A failing addon is recorded on
   *  its descriptor and never interrupts boot or its neighbours. */
  public async boot() {
    this.booted = true;
    // Host-side page scripts every addon shares, in place before any activate.
    this.services.registerYtmScript(HOST_SCRIPT_NAMESPACE, "innertubeRequest", innertubeRequestScript);
    this.pruneUninstalled();
    for (const addon of this.addons) {
      await this.activateOne(addon);
      this.publishRuntime();
    }
  }

  private async activateOne(addon: ManagedAddon) {
    const { manifest } = addon.definition;
    if (addon.scanError) {
      addon.descriptor.state = "error";
      addon.descriptor.error = addon.scanError;
      return;
    }
    if (!addon.descriptor.enabled) {
      addon.descriptor.state = "disabled";
      return;
    }
    if (!manifestSatisfiesApp(manifest, this.services.appVersion)) {
      addon.descriptor.state = "incompatible";
      addon.descriptor.error = `Needs app version ${manifest.minAppVersion} or newer`;
      return;
    }
    if (manifest.apiVersion !== undefined && manifest.apiVersion > SUPPORTED_ADDON_API_VERSION) {
      addon.descriptor.state = "incompatible";
      addon.descriptor.error = `Requires a newer app (addon API v${manifest.apiVersion})`;
      return;
    }
    const generation = ++addon.generation;
    const live = () => addon.generation === generation;
    const noop = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      addon.context = createAddonContext(
        manifest,
        this.services,
        {
          setSettingsSections: sections => {
            if (live()) this.setSettingsSections(manifest.id, sections);
          },
          addLoadedCallback: callback => {
            if (!live()) return noop;
            addon.loadedCallbacks.push(callback);
            return () => {
              addon.loadedCallbacks = addon.loadedCallbacks.filter(cb => cb !== callback);
            };
          },
          addCssHandle: handle => {
            if (live()) addon.cssHandles.push(handle);
            else handle.remove();
          },
          addCleanup: cleanup => {
            if (live()) addon.cleanups.push(cleanup);
            else this.runQuietly(cleanup);
          },
          setTitlebarBadge: badge => {
            if (live()) this.setTitlebarBadge(manifest.id, badge);
          },
          addBadgeClickCallback: callback => {
            if (!live()) return noop;
            addon.badgeClickCallbacks.push(callback);
            return () => {
              addon.badgeClickCallbacks = addon.badgeClickCallbacks.filter(cb => cb !== callback);
            };
          },
          addWindow: window => {
            if (!live()) {
              if (!window.isDestroyed()) window.close();
              return;
            }
            this.windows.add(window);
            addon.windows.push(window);
            window.once("closed", () => {
              this.windows.delete(window);
              addon.windows = addon.windows.filter(entry => entry !== window);
            });
          },
          addActionCallback: (key, callback) => {
            if (!live()) return noop;
            const list = addon.actionCallbacks.get(key) ?? [];
            list.push(callback);
            addon.actionCallbacks.set(key, list);
            return () => {
              addon.actionCallbacks.set(
                key,
                (addon.actionCallbacks.get(key) ?? []).filter(cb => cb !== callback)
              );
            };
          },
          addMessageCallback: (name, callback) => {
            if (!live()) return noop;
            const list = addon.messageCallbacks.get(name) ?? [];
            list.push(callback);
            addon.messageCallbacks.set(name, list);
            return () => {
              addon.messageCallbacks.set(
                name,
                (addon.messageCallbacks.get(name) ?? []).filter(cb => cb !== callback)
              );
            };
          },
          setTrayMenuItems: items => {
            if (live()) this.setTrayItems(manifest.id, items);
          },
          reportError: (source, error) => {
            if (live()) this.reportRuntimeError(manifest.id, source, error);
          }
        },
        addon.dir
      );
      const context = addon.context;
      const activation = (async () => (await addon.definition.activate(context)) as AddonInstance | undefined)();
      const timedOut = new Promise<"timeout">(resolve => {
        timer = setTimeout(() => resolve("timeout"), ADDON_ACTIVATE_TIMEOUT_MS);
      });
      const outcome = await Promise.race([activation.then(instance => ({ instance })), timedOut]);
      if (outcome === "timeout") {
        addon.generation++;
        this.releaseRegistrations(addon);
        addon.context = null;
        addon.descriptor.state = "error";
        addon.descriptor.error = `activate() didn't finish within ${ADDON_ACTIVATE_TIMEOUT_MS / 1000} seconds`;
        log.error(`Addon timed out while activating: ${manifest.id}`);
        activation.then(
          instance => {
            if (instance?.destroy) {
              Promise.resolve()
                .then(() => instance.destroy?.())
                .catch(error => log.error(`Addon failed to shut down cleanly: ${manifest.id}`, error));
            }
          },
          error => log.error(`Addon failed to activate after timing out: ${manifest.id}`, error)
        );
        return;
      }
      addon.instance = outcome.instance ?? {};
      addon.descriptor.state = "active";
      log.info(`Addon active: ${manifest.id} ${manifest.version}`);
      if (this.ytmViewLoaded && this.services.getYtmView()) this.runLoadedCallbacks(addon);
    } catch (error) {
      addon.descriptor.state = "error";
      addon.descriptor.error = String(error);
      log.error(`Addon failed to activate: ${manifest.id}`, error);
    } finally {
      clearTimeout(timer);
    }
  }

  private runQuietly(cleanup: () => void) {
    try {
      cleanup();
    } catch {
      // Teardown noise only hurts the addon being torn down.
    }
  }

  private releaseRegistrations(addon: ManagedAddon) {
    const id = addon.definition.manifest.id;
    for (const cleanup of addon.cleanups) this.runQuietly(cleanup);
    addon.cleanups = [];
    for (const handle of addon.cssHandles) handle.remove();
    addon.cssHandles = [];
    for (const window of [...addon.windows]) {
      if (!window.isDestroyed()) window.close();
    }
    addon.windows = [];
    addon.loadedCallbacks = [];
    addon.badgeClickCallbacks = [];
    addon.actionCallbacks.clear();
    addon.messageCallbacks.clear();
    this.setTitlebarBadge(id, null);
    this.setTrayItems(id, []);
    addon.descriptor.settingsSections = [];
  }

  /** Unwinds one addon completely: subscriptions, destroy(), styles, windows
   *  and every registry entry it owns. The reverse of activateOne. */
  private async deactivate(addon: ManagedAddon) {
    const id = addon.definition.manifest.id;
    addon.generation++;
    for (const cleanup of addon.cleanups) this.runQuietly(cleanup);
    addon.cleanups = [];
    if (addon.instance?.destroy) {
      try {
        await addon.instance.destroy();
      } catch (error) {
        log.error(`Addon failed to shut down cleanly: ${id}`, error);
      }
    }
    addon.instance = null;
    addon.context = null;
    this.releaseRegistrations(addon);
    addon.descriptor.lastError = undefined;
    addon.descriptor.error = undefined;
    addon.descriptor.state = "disabled";
  }

  /** Development-time reload of one external addon: tear down, re-read the
   *  folder with a cleared module cache, activate again. The user-facing
   *  enable and disable stay restart-scoped; this only serves editing. */
  public async reloadExternal(id: string): Promise<void> {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    if (!addon || addon.origin !== "external" || !addon.dir) return;

    await this.deactivate(addon);
    bustAddonRequireCache(addon.dir);

    const scan = scanAddonFolder(addon.dir);
    for (const warning of scan.warnings ?? []) {
      log.warn(`Addon manifest warning (${scan.folderName}): ${warning}`);
    }
    const persisted = this.persistedState(id);
    if (scan.fingerprint && persisted?.fingerprint !== undefined && persisted.fingerprint === addon.fingerprint) {
      const addonsSection = this.services.store.get("addons");
      addonsSection.states[id] = { ...persisted, fingerprint: scan.fingerprint } as PersistedAddonState;
      this.services.store.set("addons", addonsSection);
    }
    addon.fingerprint = scan.fingerprint;
    addon.scanError = scan.error;
    addon.descriptor.warnings = scan.warnings ?? [];
    if (scan.manifest) {
      addon.definition = scan.error ? { manifest: scan.manifest, activate: () => {} } : buildExternalDefinition(scan.dir, scan.manifest);
      addon.descriptor.manifest = scan.manifest;
    } else {
      addon.definition = { manifest: addon.definition.manifest, activate: () => {} };
    }

    await this.activateOne(addon);
    this.publishRuntime();
  }

  /** The YouTube Music view finished loading: re-inject styles and let addons
   *  run their page setup. An addon throwing here only hurts itself. */
  public notifyYtmViewLoaded() {
    this.ytmViewLoaded = true;
    for (const addon of this.addons) {
      if (addon.descriptor.state !== "active") continue;
      this.runLoadedCallbacks(addon);
    }
  }

  private runLoadedCallbacks(addon: ManagedAddon) {
    addon.cssHandles = addon.cssHandles.filter(handle => !handle.isRemoved);
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

  /** Replaces one addon's tray section and rebuilds the menu. */
  public setTrayItems(id: string, items: AddonTrayMenuItem[]) {
    if (items.length === 0) this.trayItems.delete(id);
    else this.trayItems.set(id, items);
    this.services.refreshTrayMenu();
  }

  /** Every addon's tray items in registration order, clicks contained. */
  public trayMenuItems(): { label: string; enabled: boolean; click: () => void }[] {
    const entries: { label: string; enabled: boolean; click: () => void }[] = [];
    for (const addon of this.addons) {
      const id = addon.definition.manifest.id;
      const items = this.trayItems.get(id);
      if (!items) continue;
      for (const item of items) {
        entries.push({
          label: item.label,
          enabled: item.enabled ?? true,
          click: () => {
            try {
              item.click();
            } catch (error) {
              log.error(`Addon tray item failed: ${id}`, error);
              this.reportRuntimeError(id, "tray.item", error);
            }
          }
        });
      }
    }
    return entries;
  }

  /** External addons run unsandboxed; the first enable asks the user once. */
  public needsRiskAcknowledgement(id: string): boolean {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    if (!addon || addon.origin !== "external") return false;
    const persisted = this.persistedState(id);
    if (persisted?.riskAcknowledged !== true) return true;
    return addon.fingerprint !== undefined && persisted.fingerprint !== addon.fingerprint;
  }

  public acknowledgeRisk(id: string) {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    const addonsSection = this.services.store.get("addons");
    const state: PersistedAddonState = { enabled: addonsSection.states[id]?.enabled ?? false, riskAcknowledged: true };
    if (addon?.fingerprint) state.fingerprint = addon.fingerprint;
    addonsSection.states[id] = state;
    this.services.store.set("addons", addonsSection);
    if (addon) {
      addon.descriptor.warnings = (addon.descriptor.warnings ?? []).filter(warning => warning !== ADDON_FILES_CHANGED_WARNING);
      this.publishRuntime();
    }
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

  /** A page script posted to its addon; returns whether anything listened. */
  public handleViewMessage(id: string, name: string, payload: unknown): boolean {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    if (!addon || addon.descriptor.state !== "active") return false;
    const callbacks = addon.messageCallbacks.get(name);
    if (!callbacks || callbacks.length === 0) return false;
    for (const callback of callbacks) {
      try {
        callback(payload);
      } catch (error) {
        log.error(`Addon view message failed: ${id}/${name}`, error);
        this.reportRuntimeError(id, `ytmview.onMessage(${name})`, error);
      }
    }
    return true;
  }

  /** A settings button field was clicked; returns whether any addon listened. */
  public handleSettingsAction(id: string, key: string): boolean {
    const addon = this.addons.find(entry => entry.definition.manifest.id === id);
    const callbacks = addon?.actionCallbacks.get(key);
    if (!addon || !callbacks || callbacks.length === 0) return false;
    for (const callback of callbacks) {
      try {
        callback();
      } catch (error) {
        log.error(`Addon settings action failed: ${id}/${key}`, error);
        this.reportRuntimeError(id, `settings.onAction(${key})`, error);
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
