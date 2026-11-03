import { describe, expect, it } from "vitest";
import { registerWindowControlIpc, type WindowControlIpcDeps } from "../src/main/ipc/window-controls";
import { registerStoreBridgeIpc, type StoreBridgeIpcDeps } from "../src/main/ipc/store-bridge";
import { registerThemeIpc, type ThemeIpcDeps } from "../src/main/ipc/themes";
import type { IpcRegistrar } from "../src/main/ipc/registrar";

function capture(register: (ipc: IpcRegistrar) => void): string[] {
  const channels: string[] = [];
  const ipc: IpcRegistrar = {
    on: (channel) => {
      channels.push(channel);
    },
    handle: (channel) => {
      channels.push(channel);
    },
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
      quitApp: () => {
        return undefined;
      },
      relaunchApp: () => {
        return undefined;
      },
      sendMainWindowState: () => {
        return undefined;
      },
      openSettingsWindow: () => {
        return undefined;
      },
    };

    expect(capture((ipc) => registerWindowControlIpc(ipc, deps))).toEqual([
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
      "settingsWindow:restore",
    ]);
  });

  it("store bridge channels stay stable", () => {
    const deps: StoreBridgeIpcDeps = {
      store: {
        set: () => {
          return undefined;
        },
        get: (): unknown => undefined,
        reset: () => {
          return undefined;
        },
      },
      memoryStore: {
        getState: (): unknown => undefined,
        set: () => {
          return undefined;
        },
        get: (): unknown => undefined,
      },
      isMemoryStoreSender: () => false,
      isSettingsSender: () => false,
      isSettingsReader: () => false,
      decryptString: () => "",
      encryptString: () => "",
    };

    expect(capture((ipc) => registerStoreBridgeIpc(ipc, deps))).toEqual([
      "memoryStore:get",
      "memoryStore:set",
      "memoryStore:subscribe",
      "safeStorage:decryptString",
      "safeStorage:encryptString",
      "settings:get",
      "settings:reset",
      "settings:set",
      "settings:setMany",
    ]);
  });

  it("theme channels stay stable", () => {
    const deps: ThemeIpcDeps = {
      descriptors: () => [],
      getCss: () => ({ app: "", ytm: "", addonWindow: "" }),
      rescan: () => {
        return undefined;
      },
      setActive: () => ({ ok: true }),
      create: () => ({ ok: true, id: "x", dir: "" }),
      duplicate: () => ({ ok: true, id: "x", dir: "" }),
      exportTo: () => ({ ok: true }),
      install: () => ({ ok: true, id: "x" }),
      openThemesFolder: () => {
        return undefined;
      },
      revealPath: () => {
        return undefined;
      },
      pickArchive: () => Promise.resolve(null),
      pickExportDestination: () => Promise.resolve(null),
      isSettingsSender: () => false,
    };

    expect(capture((ipc) => registerThemeIpc(ipc, deps))).toEqual([
      "themes:create",
      "themes:duplicate",
      "themes:export",
      "themes:getActiveCss",
      "themes:getAll",
      "themes:installFromFile",
      "themes:openFolder",
      "themes:rescan",
      "themes:setActive",
    ]);
  });
});
