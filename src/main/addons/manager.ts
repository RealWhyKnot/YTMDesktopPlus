import type Conf from "conf";
import log from "electron-log";
import type MemoryStore from "../memory-store";
import type { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import type { AddonDescriptor, AddonManifest, AddonOrigin, AddonSettingsSection } from "~shared/addons/types";
import { manifestSatisfiesApp } from "./validate-manifest";
import { AddonContext, AddonInstance, createAddonContext } from "./context";

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
};

export type AddonManagerServices = {
  store: Conf<StoreSchema>;
  memoryStore: MemoryStore<MemoryStoreSchema>;
  appVersion: string;
};

export class AddonManager {
  private addons: ManagedAddon[] = [];
  private booted = false;

  constructor(private services: AddonManagerServices) {}

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
        context: null
      });
    }
  }

  /** Activates every enabled, compatible addon. A failing addon is recorded on
   *  its descriptor and never interrupts boot or its neighbours. */
  public async boot() {
    this.booted = true;
    for (const addon of this.addons) {
      const { manifest } = addon.definition;
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
        addon.context = createAddonContext(manifest);
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

  public async shutdown() {
    for (const addon of this.addons) {
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
