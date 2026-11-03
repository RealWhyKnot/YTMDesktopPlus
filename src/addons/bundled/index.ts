import type { BundledAddonDefinition } from "../../main/addons/managed-addon";
import { roomsAddon } from "./rooms";
import { mobileBridgeAddon } from "./mobile-bridge";
import { volumeBoostAddon } from "./volume-boost";
import { blendAddon } from "./blend";
import { lyricsAddon } from "./lyrics";

export const BUNDLED_ADDONS: BundledAddonDefinition[] = [roomsAddon, mobileBridgeAddon, volumeBoostAddon, blendAddon, lyricsAddon];
