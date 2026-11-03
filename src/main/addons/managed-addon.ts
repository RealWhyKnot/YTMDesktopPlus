import type { AddonContext, AddonInstance, AddonManifest, AddonOrigin, AddonDescriptor } from "~shared/addons/sdk";
import type { AddonHostWindow } from "./context";
import type { AddonCssHandle } from "./css";

export type BundledAddonDefinition = {
  manifest: AddonManifest;
  activate(ctx: AddonContext): AddonInstance | undefined | Promise<AddonInstance | undefined>;
};

export type ManagedAddon = {
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

  dir?: string;
  scanError?: string;
  fingerprint?: string;
  generation: number;
};
