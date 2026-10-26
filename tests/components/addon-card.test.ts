import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AddonCard from "../../src/renderer/windows/settings/AddonCard.vue";
import { createStagedSettings, stagedSettingsKey } from "../../src/renderer/windows/settings/useStagedSettings";
import type { AddonDescriptor, AddonSettingsField } from "~shared/addons/types";
import { addonDescriptor, LONG_WORD, settingsState, WINDOWS_PATH_ERROR } from "./fixtures";

function mountCard(addon: AddonDescriptor, addonSettings: Record<string, unknown> = {}) {
  const keys = addon.settingsSections.flatMap(section =>
    section.fields.filter(field => field.type !== "button").map(field => `addons.settings.${addon.manifest.id}.${field.key}`)
  );
  const state = settingsState({ addons: { settings: { [addon.manifest.id]: addonSettings } } });
  const staged = createStagedSettings(state, () => {}, keys);
  const wrapper = mount(AddonCard, { props: { addon }, global: { provide: { [stagedSettingsKey as symbol]: staged } } });
  return { wrapper, staged };
}

const numberField: AddonSettingsField = { key: "count", type: "number", label: "Count", min: 1, max: 10, display: "input" };

async function openSettings(wrapper: ReturnType<typeof mount>) {
  await wrapper.find("button.expander").trigger("click");
}

describe("AddonCard", () => {
  it("keeps long load errors, runtime errors and warnings in wrapping text elements", () => {
    const { wrapper: failed } = mountCard(addonDescriptor({ state: "error", error: WINDOWS_PATH_ERROR }));
    expect(failed.find(".status .status-text").text()).toBe(WINDOWS_PATH_ERROR);

    const { wrapper: active } = mountCard(addonDescriptor({ lastError: WINDOWS_PATH_ERROR, warnings: [LONG_WORD] }));
    const texts = active.findAll(".status.runtime .status-text").map(node => node.text());
    expect(texts).toEqual([`Recent error: ${WINDOWS_PATH_ERROR}`, LONG_WORD]);
  });

  it("puts an oversized version in a tooltip as well as the pill", () => {
    const version = `1.0.0-${LONG_WORD}`;
    const { wrapper } = mountCard(addonDescriptor({ manifest: { id: "sample", name: LONG_WORD, version, author: LONG_WORD, description: LONG_WORD } }));
    const pill = wrapper.find(".pill.version");
    expect(pill.text()).toBe(`v${version}`);
    expect(pill.attributes("title")).toBe(`v${version}`);
    expect(wrapper.find(".header .name").text()).toBe(LONG_WORD);
  });

  it("labels the enable toggle with the addon name", () => {
    const { wrapper } = mountCard(addonDescriptor());
    expect(wrapper.find(".header input[type='checkbox']").attributes("aria-label")).toBe("Sample addon");
  });

  it("clamps number fields to the declared range", async () => {
    const { wrapper, staged } = mountCard(addonDescriptor({}, [numberField]), { count: 5 });
    await openSettings(wrapper);
    const input = wrapper.find("input[type='number']");

    await input.setValue("50");
    await input.trigger("change");
    expect(staged.refs["addons.settings.sample.count"].value).toBe(10);

    await input.setValue("-3");
    await input.trigger("change");
    expect(staged.refs["addons.settings.sample.count"].value).toBe(1);
  });

  it("treats a cleared number field as unchanged instead of zero", async () => {
    const { wrapper, staged } = mountCard(addonDescriptor({}, [numberField]), { count: 5 });
    await openSettings(wrapper);
    const input = wrapper.find("input[type='number']");

    await input.setValue("");
    await input.trigger("change");
    expect(staged.refs["addons.settings.sample.count"].value).toBe(5);
    expect(staged.hasUnsavedChanges.value).toBe(false);
  });

  it("marks a text field dirty while typing, before any change event", async () => {
    const textField: AddonSettingsField = { key: "label", type: "text", label: "Label" };
    const { wrapper, staged } = mountCard(addonDescriptor({}, [textField]), { label: "" });
    await openSettings(wrapper);

    const input = wrapper.find("input[type='text']");
    (input.element as HTMLInputElement).value = "typed";
    await input.trigger("input");
    expect(staged.dirtyKeys.value).toEqual(["addons.settings.sample.label"]);
    expect(staged.hasUnsavedChanges.value).toBe(true);

    (input.element as HTMLInputElement).value = "";
    await input.trigger("input");
    expect(staged.hasUnsavedChanges.value).toBe(false);
  });

  it("shows fields whose keys arrive after the card rendered", async () => {
    const lateField: AddonSettingsField = { key: "late", type: "toggle", label: "Late toggle" };
    const addon = addonDescriptor({}, [lateField]);
    const staged = createStagedSettings(settingsState(), () => {});
    const wrapper = mount(AddonCard, { props: { addon }, global: { provide: { [stagedSettingsKey as symbol]: staged } } });
    await openSettings(wrapper);
    expect(wrapper.text()).not.toContain("Late toggle");

    staged.addKeys(["addons.settings.sample.late"], { addons: { settings: { sample: { late: true } } } });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Late toggle");
  });
});
