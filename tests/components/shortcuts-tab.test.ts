import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import ShortcutsTab from "../../src/renderer/windows/settings/tabs/ShortcutsTab.vue";
import { createStagedSettings, stagedSettingsKey } from "../../src/renderer/windows/settings/useStagedSettings";
import { settingsShellKey } from "../../src/renderer/windows/settings/context";
import { settingsState } from "./fixtures";

function mountTab(shortcuts: Record<string, string>, failed: Partial<Record<string, boolean>> = {}) {
  const staged = createStagedSettings(settingsState({ shortcuts }), () => {});
  const names = ["playPause", "next", "previous", "thumbsUp", "thumbsDown", "volumeUp", "volumeDown"];
  const shortcutRegisterFailed = Object.fromEntries(names.map(name => [name, ref(failed[name] ?? false)]));
  const wrapper = mount(ShortcutsTab, {
    global: { provide: { [stagedSettingsKey as symbol]: staged, [settingsShellKey as symbol]: { shortcutRegisterFailed } } }
  });
  return { wrapper, staged };
}

describe("ShortcutsTab", () => {
  it("uses sentence case labels", () => {
    const { wrapper } = mountTab({});
    const labels = wrapper.findAll(".shortcut-title").map(node => node.text());
    expect(labels).toEqual(["Play/pause", "Next", "Previous", "Thumbs up", "Thumbs down", "Increase volume", "Decrease volume"]);
  });

  it("warns on every row that shares a binding", () => {
    const { wrapper } = mountTab({ playPause: "CmdOrCtrl+P", next: "CmdOrCtrl+P", thumbsUp: "CmdOrCtrl+P", previous: "Alt+B" });
    const rows = wrapper.findAll(".shortcut-row");
    expect(rows[0].find(".duplicate").text()).toBe("Same shortcut as Next and Thumbs up");
    expect(rows[1].find(".duplicate").text()).toBe("Same shortcut as Play/pause and Thumbs up");
    expect(rows[2].find(".duplicate").exists()).toBe(false);
    expect(rows[3].find(".duplicate").text()).toBe("Same shortcut as Play/pause and Next");
  });

  it("does not treat empty bindings as duplicates", () => {
    const { wrapper } = mountTab({});
    expect(wrapper.findAll(".duplicate")).toHaveLength(0);
  });

  it("updates the warning as soon as a binding changes", async () => {
    const { wrapper, staged } = mountTab({ playPause: "CmdOrCtrl+P" });
    staged.refs["shortcuts.next"].value = "CmdOrCtrl+P";
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".shortcut-row")[1].find(".duplicate").text()).toBe("Same shortcut as Play/pause");
    expect(staged.hasUnsavedChanges.value).toBe(true);
  });

  it("explains a registration failure in text", () => {
    const { wrapper } = mountTab({ next: "MediaNextTrack" }, { next: true });
    const row = wrapper.findAll(".shortcut-row")[1];
    expect(row.find(".register-error-text").text()).toBe("Couldn't register this shortcut. Another app might be using it.");
    expect(wrapper.findAll(".register-error-text")).toHaveLength(1);
  });
});
