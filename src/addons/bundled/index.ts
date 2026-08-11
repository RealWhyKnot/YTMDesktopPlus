import type { BundledAddonDefinition } from "../../main/addons/manager";
import roomsAddon from "./rooms";

// Addons compiled into the app. Order here is load order.
export const BUNDLED_ADDONS: BundledAddonDefinition[] = [roomsAddon];
