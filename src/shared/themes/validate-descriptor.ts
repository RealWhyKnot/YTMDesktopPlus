import type { ThemeActionResult, ThemeCss, ThemeDescriptor, ThemeManifest } from "./sdk";
import { isRecord } from "../unknown";
import { arrayOf, isBoolean, isNumber, isString, objectOf, optional } from "../validation";

export const isThemeManifestData = objectOf<ThemeManifest>({
  id: isString,
  name: isString,
  version: isString,
  author: isString,
  description: isString,
  minAppVersion: optional(isString),
  homepage: optional(isString),
  apiVersion: optional(isNumber),
  styles: optional(arrayOf(isString)),
  appStyles: optional(arrayOf(isString)),
  ytmStyles: optional(arrayOf(isString)),
  titleBarOverlay: optional(objectOf({ color: isString, symbolColor: isString })),
  preview: optional(isString),
});

export const isThemeDescriptor = objectOf<ThemeDescriptor>({
  manifest: isThemeManifestData,
  origin: (value): value is ThemeDescriptor["origin"] => value === "bundled" || value === "user",
  active: isBoolean,
  state: (value): value is ThemeDescriptor["state"] => value === "ok" || value === "error" || value === "incompatible",
  error: optional(isString),
  warnings: arrayOf(isString),
  previewDataUrl: optional(isString),
  swatch: arrayOf(isString),
  watching: isBoolean,
});

export const isThemeCss = objectOf<ThemeCss>({ app: isString, ytm: isString, addonWindow: isString });

export function isThemeActionResult(value: unknown): value is ThemeActionResult {
  return isRecord(value) && ((value.ok === true && optional(isString)(value.id)) || (value.ok === false && isString(value.reason)));
}
