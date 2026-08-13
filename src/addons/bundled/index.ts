import type { BundledAddonDefinition } from "../../main/addons/manager";
import roomsAddon from "./rooms";
import mobileBridgeAddon from "./mobile-bridge";
import volumeBoostAddon from "./volume-boost";
import djAddon from "./dj";

// Addons compiled into the app. Order here is load order.
export const BUNDLED_ADDONS: BundledAddonDefinition[] = [roomsAddon, mobileBridgeAddon, volumeBoostAddon, djAddon];
