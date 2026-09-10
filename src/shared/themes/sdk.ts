export const THEME_API_VERSION = 1;

export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export type ThemeTitleBarOverlay = {
  color: string;
  symbolColor: string;
};

export type ThemeManifest = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  minAppVersion?: string;
  homepage?: string;
  apiVersion?: number;
  styles?: string[];
  appStyles?: string[];
  ytmStyles?: string[];
  titleBarOverlay?: ThemeTitleBarOverlay;
  preview?: string;
};

export type ThemeOrigin = "bundled" | "user";

export type ThemeRuntimeState = "ok" | "error" | "incompatible";

export type ThemeDescriptor = {
  manifest: ThemeManifest;
  origin: ThemeOrigin;
  active: boolean;
  state: ThemeRuntimeState;
  error?: string;
  warnings: string[];
  previewDataUrl?: string;
  swatch: string[];
  watching: boolean;
};

export type ThemeTokens = Record<string, string>;

export type ActiveTheme = {
  id: string | null;
  name: string;
  tokens: ThemeTokens;
};

export type ThemeCss = {
  app: string;
  ytm: string;
  addonWindow: string;
};

export const EMPTY_THEME_CSS: ThemeCss = { app: "", ytm: "", addonWindow: "" };
