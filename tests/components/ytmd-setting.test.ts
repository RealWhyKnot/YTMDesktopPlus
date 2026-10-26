import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import YTMDSetting from "../../src/renderer/components/YTMDSetting.vue";
import { LONG_WORD } from "./fixtures";

describe("YTMDSetting", () => {
  it("renders an oversized name and description in full and lets them wrap", () => {
    const name = `Name ${LONG_WORD}`;
    const description = `Description ${LONG_WORD} ${LONG_WORD}`;
    const wrapper = mount(YTMDSetting, { props: { type: "text", modelValue: "", name, description } });

    expect(wrapper.find(".name").text()).toBe(name);
    expect(wrapper.find(".description").text()).toBe(description);
    expect(wrapper.find(".name-description").exists()).toBe(true);
  });

  it("labels and describes each control type", () => {
    for (const type of ["checkbox", "text", "number", "range", "select"] as const) {
      const wrapper = mount(YTMDSetting, {
        props: {
          type,
          modelValue: type === "checkbox" ? false : type === "text" ? "" : 1,
          name: `The ${type} name`,
          description: "Some help",
          optionsMap: { 1: "One" }
        }
      });
      const control = wrapper.find(type === "select" ? "select" : "input");
      const labelId = control.attributes("aria-labelledby");
      const descriptionId = control.attributes("aria-describedby");
      expect(labelId, type).toBeTruthy();
      expect(wrapper.find(`[id="${labelId}"]`).text(), type).toContain(`The ${type} name`);
      expect(wrapper.find(`[id="${descriptionId}"]`).text(), type).toBe("Some help");
    }
  });

  it("describes a disabled control with its disabled message", () => {
    const wrapper = mount(YTMDSetting, {
      props: { type: "checkbox", modelValue: false, name: "Thing", disabled: true, disabledMessage: "Not available here" }
    });
    const control = wrapper.find("input");
    expect(wrapper.find(`[id="${control.attributes("aria-describedby")}"]`).text()).toBe("Not available here");
  });

  it("gives the restart icon a tooltip and an accessible name", () => {
    const wrapper = mount(YTMDSetting, { props: { type: "checkbox", modelValue: false, name: "Speaker fill", restartRequired: true } });
    const icon = wrapper.find(".reload-required");
    expect(icon.attributes("title")).toBe("Needs a restart");
    expect(icon.attributes("aria-label")).toBe("Needs a restart");
    expect(icon.attributes("role")).toBe("img");
  });

  it("emits text edits on every keystroke", async () => {
    const wrapper = mount(YTMDSetting, { props: { type: "text", modelValue: "", name: "Text" } });
    const input = wrapper.find("input");
    for (const value of ["a", "ab"]) {
      (input.element as HTMLInputElement).value = value;
      await input.trigger("input");
    }
    expect(wrapper.emitted("update:modelValue")).toEqual([["a"], ["ab"]]);
    expect(wrapper.emitted("change")).toBeUndefined();
  });

  it("shows the range value in its own element", () => {
    const wrapper = mount(YTMDSetting, { props: { type: "range", modelValue: 100, name: "Zoom", min: 30, max: 300 } });
    expect(wrapper.find(".range-value").text()).toBe("100");
  });
});
