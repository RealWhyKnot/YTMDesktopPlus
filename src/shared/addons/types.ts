export type AddonManifest = {
  /** Folder name for external addons; ^[a-z0-9][a-z0-9-]{1,63}$ */
  id: string;
  name: string;
  /** semver */
  version: string;
  author: string;
  description: string;
  /** Oldest app version the addon works with; incompatible addons are listed but never loaded */
  minAppVersion?: string;
  /** Relative path to a CommonJS entry. Optional: pure style/script addons need none */
  main?: string;
  /** CSS files injected into the YouTube Music view, watched for edits */
  styles?: string[];
  /** Script files injected into the YouTube Music view; each must evaluate to a callable */
  ytmScripts?: string[];
  /** Bundled addons only; external addons always start disabled */
  defaultEnabled?: boolean;
};

export type AddonOrigin = "bundled" | "external";

/** What actually happened to the addon this boot, as opposed to the persisted intent */
export type AddonRuntimeState = "active" | "disabled" | "error" | "incompatible";

export type AddonSettingsField =
  | { key: string; type: "toggle"; label: string; description?: string }
  | { key: string; type: "text"; label: string; description?: string; placeholder?: string; maxlength?: number }
  | { key: string; type: "number"; label: string; description?: string; min?: number; max?: number; step?: number }
  | { key: string; type: "select"; label: string; description?: string; options: { label: string; value: number }[] };

export type AddonSettingsSection = {
  title?: string;
  fields: AddonSettingsField[];
};

export type AddonTitlebarBadge = {
  addonId: string;
  icon: string;
  text?: string;
  tooltip?: string;
  active?: boolean;
};

export type AddonDescriptor = {
  manifest: AddonManifest;
  origin: AddonOrigin;
  /** Persisted intent; takes effect on the next launch when it disagrees with state */
  enabled: boolean;
  state: AddonRuntimeState;
  error?: string;
  restartRequired: boolean;
  settingsSections: AddonSettingsSection[];
};
