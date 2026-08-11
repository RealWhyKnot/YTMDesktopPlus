import log, { type LogFunctions } from "electron-log";
import type { AddonManifest } from "~shared/addons/types";

export interface AddonInstance {
  destroy?(): void | Promise<void>;
}

// The API surface handed to an addon's activate(). Grows as the host exposes
// more of itself; addons should treat it as the only door into the app.
export interface AddonContext {
  readonly manifest: AddonManifest;
  readonly log: LogFunctions;
}

export function createAddonContext(manifest: AddonManifest): AddonContext {
  return {
    manifest,
    log: log.scope(`addon:${manifest.id}`)
  };
}
