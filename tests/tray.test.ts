import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrayDeps } from "../src/main/tray";

const electron = vi.hoisted(() => {
  const trays: { image: string }[] = [];
  class Tray {
    image: string;
    constructor(image: string) {
      this.image = image;
      trays.push(this);
    }
    setToolTip() {}
    setContextMenu() {}
    on() {}
    setImage(image: string) {
      this.image = image;
    }
  }
  return {
    trays,
    module: {
      Tray,
      Menu: { buildFromTemplate: (template: unknown) => template },
      nativeTheme: { shouldUseDarkColors: false },
      app: { getAppPath: () => "app", quit: () => {} }
    }
  };
});

vi.mock("electron", () => electron.module);

import { createTrayController } from "../src/main/tray";

function controller() {
  return createTrayController({
    store: { get: () => ({ trayIconStyle: 0 }) } as unknown as TrayDeps["store"],
    getMainWindow: () => null,
    sendRemoteCommand: () => {},
    addonTrayItems: () => []
  });
}

beforeEach(() => {
  electron.trays.length = 0;
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tray controller", () => {
  it("ignores an icon change that arrives before the tray exists", () => {
    const tray = controller();

    expect(() => tray.setTrayIcon()).not.toThrow();
    tray.createTray();
    expect(electron.trays).toHaveLength(1);
  });

  it("keeps one tray when the main window is created again", () => {
    const tray = controller();

    tray.createTray();
    tray.createTray();

    expect(electron.trays).toHaveLength(1);
  });
});
