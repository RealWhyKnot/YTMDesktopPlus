import { describe, expect, it } from "vitest";
import { registerWindowControlIpc, type WindowControlIpcDeps } from "../src/main/ipc/window-controls";
import { registerStoreBridgeIpc, type StoreBridgeIpcDeps } from "../src/main/ipc/store-bridge";
import type { IpcRegistrar } from "../src/main/ipc/registrar";

// Renderer preloads hardcode these channel names; a rename here must be a
// deliberate, cross-process change, never a refactor side effect.

function capture(register: (ipc: IpcRegistrar) => void): string[] {
  const channels: string[] = [];
  const ipc: IpcRegistrar = {
    on: channel => {
      channels.push(channel);
    },
    handle: channel => {
      channels.push(channel);
    }
  };
  register(ipc);
  return channels.sort();
}

describe("ipc channel names", () => {
  it("window control channels stay stable", () => {
    const deps: WindowControlIpcDeps = {
      getMainWindow: () => null,
      getSettingsWindow: () => null,
      isMainWindowSender: () => false,
      isSettingsSender: () => false,
      hideMainWindowOnClose: () => false,
      quitApp: () => {},
      relaunchApp: () => {},
      sendMainWindowState: () => {},
      openSettingsWindow: () => {}
    };

    expect(capture(ipc => registerWindowControlIpc(ipc, deps))).toEqual([
      "mainWindow:close",
      "mainWindow:maximize",
      "mainWindow:minimize",
      "mainWindow:requestWindowState",
      "mainWindow:restore",
      "settingsWindow:close",
      "settingsWindow:maximize",
      "settingsWindow:minimize",
      "settingsWindow:open",
      "settingsWindow:restartapplication",
      "settingsWindow:restore"
    ]);
  });

  it("store bridge channels stay stable", () => {
    const deps: StoreBridgeIpcDeps = {
      store: { set: () => {}, get: (): unknown => undefined, reset: () => {} } as unknown as StoreBridgeIpcDeps["store"],
      memoryStore: { set: () => {}, get: (): unknown => undefined } as unknown as StoreBridgeIpcDeps["memoryStore"],
      isMemoryStoreSender: () => false,
      isSettingsSender: () => false,
      isSettingsReader: () => false,
      decryptString: () => "",
      encryptString: () => ""
    };

    expect(capture(ipc => registerStoreBridgeIpc(ipc, deps))).toEqual([
      "memoryStore:get",
      "memoryStore:set",
      "safeStorage:decryptString",
      "safeStorage:encryptString",
      "settings:get",
      "settings:reset",
      "settings:set",
      "settings:setMany"
    ]);
  });
});
