import type { AddonDescriptor, AddonManifest, AddonSettingsField, AddonTitlebarBadge } from "./sdk";
import { isRecord } from "../unknown";
import { arrayOf, isBoolean, isNumber, isString, objectOf, optional } from "../validation";

export const isAddonManifestData = objectOf<AddonManifest>({
  id: isString,
  name: isString,
  version: isString,
  author: isString,
  description: isString,
  minAppVersion: optional(isString),
  homepage: optional(isString),
  apiVersion: optional(isNumber),
  main: optional(isString),
  styles: optional(arrayOf(isString)),
  ytmScripts: optional(arrayOf(isString)),
  defaultEnabled: optional(isBoolean),
});

const isOption = objectOf({ label: isString, value: (value): value is string | number => isString(value) || isNumber(value) });

export function isAddonSettingsField(value: unknown): value is AddonSettingsField {
  if (!isRecord(value) || !isString(value.key) || !isString(value.label) || !optional(isString)(value.description)) return false;
  switch (value.type) {
    case "toggle":
      return true;
    case "text":
      return optional(isString)(value.placeholder) && optional(isNumber)(value.maxlength);
    case "number":
      return (
        optional(isNumber)(value.min) &&
        optional(isNumber)(value.max) &&
        optional(isNumber)(value.step) &&
        (value.display === undefined || value.display === "slider" || value.display === "input")
      );
    case "select":
      return arrayOf(isOption)(value.options);
    case "button":
      return isString(value.buttonText);
    default:
      return false;
  }
}

export const isAddonDescriptor = objectOf<AddonDescriptor>({
  manifest: isAddonManifestData,
  origin: (value): value is AddonDescriptor["origin"] => value === "bundled" || value === "external",
  enabled: isBoolean,
  state: (value): value is AddonDescriptor["state"] => value === "active" || value === "disabled" || value === "error" || value === "incompatible",
  error: optional(isString),
  lastError: optional(isString),
  warnings: optional(arrayOf(isString)),
  restartRequired: isBoolean,
  settingsSections: arrayOf(objectOf({ title: optional(isString), fields: arrayOf(isAddonSettingsField) })),
});

export const isAddonTitlebarBadge = objectOf<AddonTitlebarBadge>({
  addonId: isString,
  icon: isString,
  text: optional(isString),
  tooltip: optional(isString),
  active: optional(isBoolean),
});
