import type { AddonSettingsSection, AddonTitlebarBadge } from "~shared/addons/sdk";

export type NumberBounds = { min?: number; max?: number };

export const BADGE_TEXT_LIMIT = 12;
export const BADGE_TOOLTIP_LIMIT = 200;
export const BADGE_ICON_LIMIT = 64;

const finiteOrUndefined = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export function numberFieldBounds(sections: AddonSettingsSection[]): Map<string, NumberBounds> {
  const bounds = new Map<string, NumberBounds>();
  for (const section of Array.isArray(sections) ? sections : []) {
    for (const field of Array.isArray(section?.fields) ? section.fields : []) {
      if (field?.type !== "number" || typeof field.key !== "string") continue;
      bounds.set(field.key, { min: finiteOrUndefined(field.min), max: finiteOrUndefined(field.max) });
    }
  }
  return bounds;
}

export function clampNumberSetting(value: number, bounds: NumberBounds): number {
  if (bounds.min !== undefined && value < bounds.min) return bounds.min;
  if (bounds.max !== undefined && value > bounds.max) return bounds.max;
  return value;
}

export function correctNumberSetting(value: unknown, bounds: NumberBounds, fallbacks: unknown[]): { changed: boolean; value: unknown } {
  if (typeof value === "number" && Number.isFinite(value)) {
    const clamped = clampNumberSetting(value, bounds);
    return { changed: !Object.is(clamped, value), value: clamped };
  }
  if (value !== null && typeof value !== "number") return { changed: false, value };
  const fallback = fallbacks.find(candidate => typeof candidate === "number" && Number.isFinite(candidate)) as number | undefined;
  if (fallback === undefined) return { changed: false, value };
  return { changed: true, value: clampNumberSetting(fallback, bounds) };
}

export function clampText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const characters = Array.from(value);
  return characters.length <= limit ? value : `${characters.slice(0, limit - 1).join("")}…`;
}

export function clampBadge(badge: Omit<AddonTitlebarBadge, "addonId"> | null): Omit<AddonTitlebarBadge, "addonId"> | null {
  if (badge === null || typeof badge !== "object") return null;
  return {
    icon: clampText(badge.icon, BADGE_ICON_LIMIT) ?? "",
    text: clampText(badge.text, BADGE_TEXT_LIMIT),
    tooltip: clampText(badge.tooltip, BADGE_TOOLTIP_LIMIT),
    active: badge.active === true
  };
}
