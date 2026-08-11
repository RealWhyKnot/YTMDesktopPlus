import fs from "fs";
import path from "path";

export const CUSTOM_CSS_ADDON_ID = "my-custom-css";

export type CustomCssMigrationResult = { migrated: false } | { migrated: true; addonId: string; enabled: boolean; addonDir: string };

/** Converts the old appearance.customCSSPath setting into a styles-only addon
 *  folder. The stylesheet is copied, so the addon owns its file from then on. */
export function migrateCustomCssSetting(appearance: Record<string, unknown>, addonsDir: string): CustomCssMigrationResult {
  const cssPath = appearance.customCSSPath;
  if (typeof cssPath !== "string" || cssPath.length === 0) return { migrated: false };
  if (!fs.existsSync(cssPath)) return { migrated: false };

  const addonDir = path.join(addonsDir, CUSTOM_CSS_ADDON_ID);
  if (fs.existsSync(addonDir)) return { migrated: false };

  fs.mkdirSync(addonDir, { recursive: true });
  fs.copyFileSync(cssPath, path.join(addonDir, "styles.css"));
  const manifest = {
    id: CUSTOM_CSS_ADDON_ID,
    name: "My Custom CSS",
    version: "1.0.0",
    author: "you",
    description: "Styles migrated from the old Custom CSS setting",
    styles: ["styles.css"]
  };
  fs.writeFileSync(path.join(addonDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  return { migrated: true, addonId: CUSTOM_CSS_ADDON_ID, enabled: appearance.customCSSEnabled === true, addonDir };
}
