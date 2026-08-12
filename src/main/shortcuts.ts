import log from "electron-log";
import { globalShortcut } from "electron";
import type Conf from "conf";
import type MemoryStore from "./memory-store";
import type { MemoryStoreSchema, StoreSchema } from "../shared/store/schema";

const SHORTCUT_BINDINGS = [
  { key: "playPause", command: "playPause", flag: "shortcutsPlayPauseRegisterFailed" },
  { key: "next", command: "next", flag: "shortcutsNextRegisterFailed" },
  { key: "previous", command: "previous", flag: "shortcutsPreviousRegisterFailed" },
  { key: "thumbsUp", command: "toggleLike", flag: "shortcutsThumbsUpRegisterFailed" },
  { key: "thumbsDown", command: "toggleDislike", flag: "shortcutsThumbsDownRegisterFailed" },
  { key: "volumeUp", command: "volumeUp", flag: "shortcutsVolumeUpRegisterFailed" },
  { key: "volumeDown", command: "volumeDown", flag: "shortcutsVolumeDownRegisterFailed" }
] as const;

export function anyShortcutChanged(newState: Readonly<StoreSchema>, oldState: Readonly<StoreSchema>): boolean {
  return SHORTCUT_BINDINGS.some(binding => newState.shortcuts[binding.key] !== oldState.shortcuts[binding.key]);
}

export interface ShortcutDeps {
  store: Conf<StoreSchema>;
  memoryStore: MemoryStore<MemoryStoreSchema>;
  sendRemoteCommand(command: string): void;
}

export function createShortcutRegistrar(deps: ShortcutDeps) {
  return function registerShortcuts(): void {
    const shortcuts = deps.store.get("shortcuts");

    globalShortcut.unregisterAll();
    log.info("Unregistered shortcuts");

    for (const binding of SHORTCUT_BINDINGS) {
      const accelerator = shortcuts[binding.key];
      if (!accelerator) {
        deps.memoryStore.set(binding.flag, false);
        continue;
      }

      let registered = false;
      try {
        registered = globalShortcut.register(accelerator, () => deps.sendRemoteCommand(binding.command));
      } catch {
        /* ignored */
      }

      if (!registered) {
        log.info(`Failed to register shortcut: ${binding.key}`);
      } else {
        log.info(`Registered shortcut: ${binding.key}`);
      }
      deps.memoryStore.set(binding.flag, !registered);
    }

    log.info("Registered shortcuts");
  };
}
