import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, Suspense } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import Settings from "../../src/renderer/windows/settings/Settings.vue";
import { addonDescriptor, settingsState } from "./fixtures";
import type { AddonDescriptor } from "~shared/addons/types";

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
  const memory: Record<string, unknown> = { safeStorageAvailable: true, ...options.memory };
  const ytmd = {
    isDarwin: false,
    isLinux: false,
    getAppVersion: vi.fn(async () => "2.0.11"),
    isAppUpdateAvailable: vi.fn(async () => false),
    isAppUpdateDownloaded: vi.fn(async () => true),
    store: {
      get: vi.fn(async (key: string) => state[key]),
      set: vi.fn(),
      setMany: vi.fn(),
      onDidAnyChange: (listener: Listener) => storeListeners.push(listener)
    },
    memoryStore: {
      get: vi.fn(async (key: string) => memory[key]),
      set: vi.fn(),
      onStateChanged: (listener: Listener) => memoryListeners.push(listener)
    },
    safeStorage: {
      decryptString: vi.fn(options.decrypt ?? (async () => "[]")),
      encryptString: vi.fn(async () => "")
    },
    addons: {
      getAll: vi.fn(async () => options.addons ?? []),
      setEnabled: vi.fn(),
      openFolder: vi.fn(),
      invokeAction: vi.fn(),
      openHomepage: vi.fn(),
      getRecentLog: vi.fn(async () => [])
    },
    restartApplication: vi.fn(),
    restartApplicationForUpdate: vi.fn(),
    checkForUpdates: vi.fn(),
    handleCheckingForUpdate: vi.fn(),
    handleUpdateAvailable: vi.fn(),
    handleUpdateNotAvailable: vi.fn(),
    handleUpdateDownloaded: vi.fn(),
    closeWindow: vi.fn()
  };
  return { ytmd, state, storeListeners, memoryListeners };
}

let wrapper: VueWrapper | null = null;

async function mountSettings(ytmd: unknown) {
  (window as unknown as { ytmd: unknown }).ytmd = ytmd;
  wrapper = mount({ render: () => h(Suspense, null, { default: () => h(Settings) }) }, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

function tabs() {
  return wrapper!.findAll("[role='tab']");
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
    expect(wrapper!.find("[role='tablist']").attributes("aria-orientation")).toBe("vertical");
    const all = tabs();
    expect(all.map(tab => tab.element.tagName)).toEqual(all.map(() => "BUTTON"));
    expect(all.filter(tab => tab.attributes("tabindex") === "0")).toHaveLength(1);
    expect(all[0].attributes("aria-selected")).toBe("true");
    const panel = wrapper!.find("[role='tabpanel']");
    expect(panel.attributes("aria-labelledby")).toBe(all[0].attributes("id"));
    expect(all[0].attributes("aria-controls")).toBe(panel.attributes("id"));
  });

  it("moves selection and focus with the arrow, Home and End keys", async () => {
    await mountSettings(createYtmd().ytmd);
    await tabs()[0].trigger("keydown", { key: "ArrowDown" });
    expect(tabs()[1].attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[1].element);

    await tabs()[1].trigger("keydown", { key: "ArrowUp" });
    await tabs()[0].trigger("keydown", { key: "ArrowUp" });
    const last = tabs().length - 1;
    expect(tabs()[last].attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[last].element);

    await tabs()[last].trigger("keydown", { key: "Home" });
    expect(tabs()[0].attributes("aria-selected")).toBe("true");
    await tabs()[0].trigger("keydown", { key: "End" });
    expect(tabs()[last].attributes("aria-selected")).toBe("true");
    expect(tabs()[last].text()).toContain("About");
  });

  it("shows the save bar while a field has a draft change", async () => {
    await mountSettings(createYtmd().ytmd);
    expect(wrapper!.find(".save-bar").exists()).toBe(false);
    await wrapper!.find("input[type='checkbox']").setValue(false);
    expect(wrapper!.find(".save-bar").exists()).toBe(true);
    expect(wrapper!.find(".save-bar .save-button").text()).toBe("Save changes");
  });

  it("opens the close dialog on unload with unsaved changes, and Escape returns focus", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    const toggle = wrapper!.find("input[type='checkbox']");
    await toggle.setValue(false);
    (toggle.element as HTMLElement).focus();

    const event = new Event("beforeunload") as BeforeUnloadEvent;
    window.onbeforeunload!(event);
    await flushPromises();

    const dialog = wrapper!.find("[role='dialog']");
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("aria-modal")).toBe("true");
    expect(wrapper!.find(`#${dialog.attributes("aria-labelledby")}`).text()).toBe("Unsaved changes");
    expect(dialog.element.contains(document.activeElement)).toBe(true);

    await dialog.trigger("keydown", { key: "Escape" });
    expect(wrapper!.find("[role='dialog']").exists()).toBe(false);
    expect(document.activeElement).toBe(toggle.element);
    expect(ytmd.closeWindow).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the close dialog", async () => {
    await mountSettings(createYtmd().ytmd);
    await wrapper!.find("input[type='checkbox']").setValue(false);
    window.onbeforeunload!(new Event("beforeunload") as BeforeUnloadEvent);
    await flushPromises();

    const buttons = wrapper!.findAll("[role='dialog'] button");
    (buttons[buttons.length - 1].element as HTMLElement).focus();
    await buttons[buttons.length - 1].trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0].element);
    await buttons[0].trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1].element);
  });

  it("restarts for an update straight away when nothing is unsaved", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    await tabs()[tabs().length - 1].trigger("click");
    await wrapper!.find(".update-button").trigger("click");
    expect(ytmd.restartApplicationForUpdate).toHaveBeenCalledTimes(1);
  });

  it("asks about unsaved changes before an update restart, then saves and restarts", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    await wrapper!.find("input[type='checkbox']").setValue(false);
    await tabs()[tabs().length - 1].trigger("click");
    await wrapper!.find(".update-button").trigger("click");
    await flushPromises();

    expect(ytmd.restartApplicationForUpdate).not.toHaveBeenCalled();
    const buttons = wrapper!.findAll("[role='dialog'] button").map(button => button.text());
    expect(buttons).toEqual(["Keep editing", "Discard and restart", "Save and restart"]);

    await wrapper!.find("[role='dialog'] .save-button").trigger("click");
    expect(ytmd.store.setMany).toHaveBeenCalledTimes(1);
    expect(ytmd.restartApplicationForUpdate).toHaveBeenCalledTimes(1);
    expect(ytmd.closeWindow).not.toHaveBeenCalled();
    expect(wrapper!.find(".save-bar").exists()).toBe(false);
  });

  it("discards and restarts for an update without saving", async () => {
    const { ytmd } = createYtmd();
    await mountSettings(ytmd);
    await wrapper!.find("input[type='checkbox']").setValue(false);
    await tabs()[tabs().length - 1].trigger("click");
    await wrapper!.find(".update-button").trigger("click");
    await flushPromises();

    await wrapper!.find("[role='dialog'] .discard-button").trigger("click");
    expect(ytmd.store.setMany).not.toHaveBeenCalled();
    expect(ytmd.restartApplicationForUpdate).toHaveBeenCalledTimes(1);
    const event = new Event("beforeunload") as BeforeUnloadEvent;
    window.onbeforeunload!(event);
    expect(event.returnValue).not.toBe(false);
  });

  it("still renders when the token blob cannot be decrypted or parsed", async () => {
    await mountSettings(
      createYtmd({
        decrypt: async () => {
          throw new Error("keychain changed");
        }
      }).ytmd
    );
    expect(wrapper!.find("[role='tablist']").exists()).toBe(true);
    wrapper!.unmount();

    const { ytmd, state, storeListeners } = createYtmd({ decrypt: async () => "{not json" });
    await mountSettings(ytmd);
    expect(wrapper!.find("[role='tablist']").exists()).toBe(true);
    for (const listener of storeListeners) listener(state);
    await flushPromises();
    expect(wrapper!.find("[role='tablist']").exists()).toBe(true);
  });

  it("shows addon fields that register after the window opened", async () => {
    const addon = addonDescriptor();
    const { ytmd, state, memoryListeners } = createYtmd({ addons: [addon] });
    state.addons = { settings: { sample: { mode: true } } };
    await mountSettings(ytmd);
    await wrapper!
      .findAll("[role='tab']")
      .find(tab => tab.text().includes("Addons"))!
      .trigger("click");
    await wrapper!
      .find(".addon-card button.expander")
      .trigger("click")
      .catch((): undefined => undefined);
    expect(wrapper!.text()).not.toContain("Late mode");

    const late = addonDescriptor({}, [{ key: "mode", type: "toggle", label: "Late mode" }]);
    for (const listener of memoryListeners) listener({ addonsRuntime: [late] });
    await flushPromises();
    await wrapper!.find(".addon-card button.expander").trigger("click");
    expect(wrapper!.text()).toContain("Late mode");
  });

  it("keeps the Last.fm section usable when the session was dropped", async () => {
    const { ytmd } = createYtmd({
      state: { integrations: { companionServerEnabled: false, lastFMEnabled: true }, lastfm: { scrobblePercent: 50, sessionKey: null } }
    });
    await mountSettings(ytmd);
    await wrapper!
      .findAll("[role='tab']")
      .find(tab => tab.text().includes("Integrations"))!
      .trigger("click");
    const status = wrapper!.findAll(".setting.indented").find(node => node.text().includes("Last.fm"))!;
    expect(status.find("p").text()).toBe("Signed in to Last.fm: No");
    expect(wrapper!.text()).toContain("Scrobble percent");

    const connect = status.find("button");
    expect(connect.text()).toBe("Connect");
    await connect.trigger("click");
    expect(ytmd.store.set.mock.calls).toEqual([
      ["integrations.lastFMEnabled", false],
      ["integrations.lastFMEnabled", true]
    ]);
  });

  it("says Discord is still retrying after the connection fails", async () => {
    const { ytmd } = createYtmd({
      state: { integrations: { companionServerEnabled: false, discordPresenceEnabled: true } },
      memory: { discordPresenceConnectionFailed: true }
    });
    await mountSettings(ytmd);
    await wrapper!
      .findAll("[role='tab']")
      .find(tab => tab.text().includes("Integrations"))!
      .trigger("click");
    expect(wrapper!.find(".discord-failure").text()).toBe("Can't connect to Discord. Still trying.");
  });
});
