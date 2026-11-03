import { requireElement } from "../helpers/require-element";
import { requireValue } from "../helpers/require-value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, Suspense } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import Settings from "../../src/renderer/windows/settings/Settings.vue";
import { addonDescriptor, settingsState } from "./fixtures";
import type { AddonDescriptor } from "~shared/addons/sdk";

type Listener = (state: Record<string, unknown>) => void;

function createYtmd(
  options: {
    decrypt?: () => Promise<string>;
    addons?: AddonDescriptor[];
    state?: Record<string, Record<string, unknown>>;
    memory?: Record<string, unknown>;
  } = {}
) {
  const state = settingsState({ integrations: { companionServerEnabled: true }, ...options.state });
  const storeListeners: Listener[] = [];
  const memoryListeners: Listener[] = [];
  const memory = new Map<string, unknown>(Object.entries({ safeStorageAvailable: true, ...options.memory }));
  const ytmd = {
    isDarwin: false,
    isLinux: false,
    getAppVersion: vi.fn(() => Promise.resolve("2.0.11")),
    isAppUpdateAvailable: vi.fn(() => Promise.resolve(false)),
    isAppUpdateDownloaded: vi.fn(() => Promise.resolve(true)),
    store: {
      get: vi.fn((key: string) => Promise.resolve(state[key])),
      set: vi.fn(),
      setMany: vi.fn(),
      onDidAnyChange: (listener: Listener) => storeListeners.push(listener),
    },
    memoryStore: {
      get: vi.fn((key: string) => Promise.resolve(memory.get(key))),
      set: vi.fn(),
      onStateChanged: (listener: Listener) => memoryListeners.push(listener),
    },
    safeStorage: {
      decryptString: vi.fn(options.decrypt ?? (() => Promise.resolve("[]"))),
      encryptString: vi.fn(() => Promise.resolve("")),
    },
    addons: {
      getAll: vi.fn(() => Promise.resolve(options.addons ?? [])),
      setEnabled: vi.fn(),
      openFolder: vi.fn(),
      invokeAction: vi.fn(),
      openHomepage: vi.fn(),
      getRecentLog: vi.fn(() => Promise.resolve([])),
    },
    restartApplication: vi.fn(),
    restartApplicationForUpdate: vi.fn(),
    checkForUpdates: vi.fn(),
    handleCheckingForUpdate: vi.fn(),
    handleUpdateAvailable: vi.fn(),
    handleUpdateNotAvailable: vi.fn(),
    handleUpdateDownloaded: vi.fn(),
    closeWindow: vi.fn(),
  };
  return { ytmd, state, storeListeners, memoryListeners };
}

let wrapper: VueWrapper | null = null;

async function mountSettings(ytmd: unknown) {
  Reflect.set(window, "ytmd", ytmd);
  wrapper = mount({ render: () => h(Suspense, null, { default: () => h(Settings) }) }, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

function tabs() {
  return requireValue(wrapper).findAll("[role='tab']");
}

function checkboxNamed(name: string) {
  const label = requireValue(wrapper)
    .findAll("p[id]")
    .find((node) => node.text() === name);
  return label ? requireValue(wrapper).find(`input[type='checkbox'][aria-labelledby='${label.attributes("id")}']`) : null;
}

beforeEach(() => {
  vi.stubGlobal("YTMD_GIT_COMMIT_HASH", "0123456789abcdef");
  vi.stubGlobal("YTMD_GIT_BRANCH", "main");
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  window.onbeforeunload = null;
  vi.unstubAllGlobals();
});

describe("Settings window", () => {
  it("renders the sidebar as a tablist of buttons with one tab stop", async () => {
    await mountSettings(createYtmd().ytmd);
    expect(requireValue(wrapper).find("[role='tablist']").attributes("aria-orientation")).toBe("vertical");
    const all = tabs();
    expect(all.map((tab) => tab.element.tagName)).toEqual(all.map(() => "BUTTON"));
    expect(all.filter((tab) => tab.attributes("tabindex") === "0")).toHaveLength(1);
    expect(requireValue(all[0]).attributes("aria-selected")).toBe("true");
    const panel = requireValue(wrapper).find("[role='tabpanel']");
    expect(panel.attributes("aria-labelledby")).toBe(requireValue(all[0]).attributes("id"));
    expect(requireValue(all[0]).attributes("aria-controls")).toBe(panel.attributes("id"));
  });

  it("moves selection and focus with the arrow, Home and End keys", async () => {
    await mountSettings(createYtmd().ytmd);
    await requireValue(tabs()[0]).trigger("keydown", { key: "ArrowDown" });
    expect(requireValue(tabs()[1]).attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(requireValue(tabs()[1]).element);

    await requireValue(tabs()[1]).trigger("keydown", { key: "ArrowUp" });
    await requireValue(tabs()[0]).trigger("keydown", { key: "ArrowUp" });
    const last = tabs().length - 1;
    expect(requireValue(tabs()[last]).attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(requireValue(tabs()[last]).element);

    await requireValue(tabs()[last]).trigger("keydown", { key: "Home" });
    expect(requireValue(tabs()[0]).attributes("aria-selected")).toBe("true");
    await requireValue(tabs()[0]).trigger("keydown", { key: "End" });
    expect(requireValue(tabs()[last]).attributes("aria-selected")).toBe("true");
    expect(requireValue(tabs()[last]).text()).toContain("About");
  });

  it("shows the save bar while a field has a draft change", async () => {
    await mountSettings(createYtmd().ytmd);
    expect(requireValue(wrapper).find(".save-bar").exists()).toBe(false);
    await requireValue(wrapper).find("input[type='checkbox']").setValue(false);
    expect(requireValue(wrapper).find(".save-bar").exists()).toBe(true);
    expect(requireValue(wrapper).find(".save-bar .save-button").text()).toBe("Save changes");
  });

  it("opens the close dialog on unload with unsaved changes, and Escape returns focus", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    const toggle = requireValue(wrapper).find("input[type='checkbox']");
    await toggle.setValue(false);
    requireElement(toggle.element, HTMLElement).focus();

    const event = new Event("beforeunload");
    requireValue(window.onbeforeunload).call(window, event);
    await flushPromises();

    const dialog = requireValue(wrapper).find("[role='dialog']");
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("aria-modal")).toBe("true");
    expect(
      requireValue(wrapper)
        .find(`#${dialog.attributes("aria-labelledby")}`)
        .text()
    ).toBe("Unsaved changes");
    expect(dialog.element.contains(document.activeElement)).toBe(true);

    await dialog.trigger("keydown", { key: "Escape" });
    expect(requireValue(wrapper).find("[role='dialog']").exists()).toBe(false);
    expect(document.activeElement).toBe(toggle.element);
    expect(ytmd.closeWindow).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the close dialog", async () => {
    await mountSettings(createYtmd().ytmd);
    await requireValue(wrapper).find("input[type='checkbox']").setValue(false);
    requireValue(window.onbeforeunload).call(window, new Event("beforeunload"));
    await flushPromises();

    const buttons = requireValue(wrapper).findAll("[role='dialog'] button");
    requireElement(requireValue(buttons[buttons.length - 1]).element, HTMLElement).focus();
    await requireValue(buttons[buttons.length - 1]).trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(requireValue(buttons[0]).element);
    await requireValue(buttons[0]).trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(requireValue(buttons[buttons.length - 1]).element);
  });

  it("saves the start minimized setting", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    const toggle = checkboxNamed("Start minimized to tray");
    expect(toggle?.exists()).toBe(true);
    expect(requireElement(requireValue(toggle).element, HTMLInputElement).checked).toBe(false);
    await requireValue(toggle).setValue(true);
    await requireValue(wrapper).find(".save-bar .save-button").trigger("click");
    expect(ytmd.store.setMany).toHaveBeenCalledWith([["general.startMinimized", true]]);
  });

  it("leaves out start minimized on macOS", async () => {
    const { ytmd } = createYtmd();
    await mountSettings({ ...ytmd, isDarwin: true });
    expect(checkboxNamed("Start minimized to tray")).toBeNull();
    expect(requireValue(wrapper).text()).not.toContain("Start minimized to tray");
  });

  it("restarts for an update straight away when nothing is unsaved", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    await requireValue(tabs()[tabs().length - 1]).trigger("click");
    await requireValue(wrapper).find(".update-button").trigger("click");
    expect(ytmd.restartApplicationForUpdate).toHaveBeenCalledTimes(1);
  });

  it("asks about unsaved changes before an update restart, then saves and restarts", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    await requireValue(wrapper).find("input[type='checkbox']").setValue(false);
    await requireValue(tabs()[tabs().length - 1]).trigger("click");
    await requireValue(wrapper).find(".update-button").trigger("click");
    await flushPromises();

    expect(ytmd.restartApplicationForUpdate).not.toHaveBeenCalled();
    const buttons = requireValue(wrapper)
      .findAll("[role='dialog'] button")
      .map((button) => button.text());
    expect(buttons).toEqual(["Keep editing", "Discard and restart", "Save and restart"]);

    await requireValue(wrapper).find("[role='dialog'] .save-button").trigger("click");
    expect(ytmd.store.setMany).toHaveBeenCalledTimes(1);
    expect(ytmd.restartApplicationForUpdate).toHaveBeenCalledTimes(1);
    expect(ytmd.closeWindow).not.toHaveBeenCalled();
    expect(requireValue(wrapper).find(".save-bar").exists()).toBe(false);
  });

  it("discards and restarts for an update without saving", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    await requireValue(wrapper).find("input[type='checkbox']").setValue(false);
    await requireValue(tabs()[tabs().length - 1]).trigger("click");
    await requireValue(wrapper).find(".update-button").trigger("click");
    await flushPromises();

    await requireValue(wrapper).find("[role='dialog'] .discard-button").trigger("click");
    expect(ytmd.store.setMany).not.toHaveBeenCalled();
    expect(ytmd.restartApplicationForUpdate).toHaveBeenCalledTimes(1);
    const event = new Event("beforeunload", { cancelable: true });
    requireValue(window.onbeforeunload).call(window, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("blocks each dirty close attempt and leaves visibility changes alone", async () => {
    await mountSettings(createYtmd().ytmd);
    const clean = new Event("beforeunload", { cancelable: true });
    requireValue(window.onbeforeunload).call(window, clean);
    expect(clean.defaultPrevented).toBe(false);
    await requireValue(wrapper).find("input[type='checkbox']").setValue(false);
    window.dispatchEvent(new Event("pagehide"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(requireValue(wrapper).find("[role='dialog']").exists()).toBe(false);
    for (const attempt of [1, 2, 3]) {
      const closing = new Event("beforeunload", { cancelable: true });
      requireValue(window.onbeforeunload).call(window, closing);
      await flushPromises();
      expect(closing.defaultPrevented, `close attempt ${attempt}`).toBe(true);
      expect(requireValue(wrapper).find("[role='dialog']").exists()).toBe(true);
      await requireValue(wrapper).find("[role='dialog'] .keep-button").trigger("click");
    }
  });

  it("still renders when the token blob cannot be decrypted or parsed", async () => {
    await mountSettings(
      createYtmd({
        decrypt: () => Promise.reject(new Error("keychain changed")),
      }).ytmd
    );
    expect(requireValue(wrapper).find("[role='tablist']").exists()).toBe(true);
    requireValue(wrapper).unmount();

    const { ytmd, state, storeListeners } = createYtmd({ decrypt: () => Promise.resolve("{not json") });
    await mountSettings(ytmd);
    expect(requireValue(wrapper).find("[role='tablist']").exists()).toBe(true);
    for (const listener of storeListeners) listener(state);
    await flushPromises();
    expect(requireValue(wrapper).find("[role='tablist']").exists()).toBe(true);
  });

  it("shows addon fields that register after the window opened", async () => {
    const addon = addonDescriptor();
    const { ytmd, state, memoryListeners } = createYtmd({ addons: [addon] });
    state.addons = { settings: { sample: { mode: true } } };
    await mountSettings(ytmd);
    await requireValue(
      requireValue(wrapper)
        .findAll("[role='tab']")
        .find((tab) => tab.text().includes("Addons"))
    ).trigger("click");
    await requireValue(wrapper)
      .find(".addon-card button.expander")
      .trigger("click")
      .catch((error: unknown) => {
        console.warn("settings-window.test: operation failed", error);
        return undefined;
      });
    expect(requireValue(wrapper).text()).not.toContain("Late mode");

    const late = addonDescriptor({}, [{ key: "mode", type: "toggle", label: "Late mode" }]);
    for (const listener of memoryListeners) listener({ addonsRuntime: [late] });
    await flushPromises();
    await requireValue(wrapper).find(".addon-card button.expander").trigger("click");
    expect(requireValue(wrapper).text()).toContain("Late mode");
  });

  it("keeps the Last.fm section usable when the session was dropped", async () => {
    const { ytmd } = createYtmd({
      state: { integrations: { companionServerEnabled: false, lastFMEnabled: true }, lastfm: { scrobblePercent: 50, sessionKey: null } },
    });
    await mountSettings(ytmd);
    await requireValue(
      requireValue(wrapper)
        .findAll("[role='tab']")
        .find((tab) => tab.text().includes("Integrations"))
    ).trigger("click");
    const status = requireValue(
      requireValue(wrapper)
        .findAll(".setting.indented")
        .find((node) => node.text().includes("Last.fm"))
    );
    expect(status.find("p").text()).toBe("Signed in to Last.fm: No");
    expect(requireValue(wrapper).text()).toContain("Scrobble percent");

    const connect = status.find("button");
    expect(connect.text()).toBe("Connect");
    await connect.trigger("click");
    expect(ytmd.store.set.mock.calls).toEqual([
      ["integrations.lastFMEnabled", false],
      ["integrations.lastFMEnabled", true],
    ]);
  });

  it("says Discord is still retrying after the connection fails", async () => {
    const { ytmd } = createYtmd({
      state: { integrations: { companionServerEnabled: false, discordPresenceEnabled: true } },
      memory: { discordPresenceConnectionFailed: true },
    });
    await mountSettings(ytmd);
    await requireValue(
      requireValue(wrapper)
        .findAll("[role='tab']")
        .find((tab) => tab.text().includes("Integrations"))
    ).trigger("click");
    expect(requireValue(wrapper).find(".discord-failure").text()).toBe("Can't connect to Discord. Still trying.");
  });
});
