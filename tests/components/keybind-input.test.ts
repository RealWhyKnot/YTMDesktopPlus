import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import KeybindInput from "../../src/renderer/components/KeybindInput.vue";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("KeybindInput", () => {
  it("records a key combination", async () => {
    wrapper = mount(KeybindInput, { props: { modelValue: "" }, attachTo: document.body });
    await wrapper.find("input").trigger("keydown", { key: "p", keyCode: 80, ctrlKey: true });
    expect(wrapper.emitted("update:modelValue")).toEqual([["CmdOrCtrl+P"]]);
  });

  it("cancels the edit on Escape and keeps the binding", async () => {
    wrapper = mount(KeybindInput, { props: { modelValue: "CmdOrCtrl+P", label: "Play/pause" }, attachTo: document.body });
    const input = wrapper.find("input");
    (input.element as HTMLInputElement).focus();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".keybind").classes()).toContain("is-editing");

    await input.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.emitted("change")).toBeUndefined();
    expect(document.activeElement).not.toBe(input.element);
    expect(wrapper.find(".keybind-text").text()).toBe("CmdOrCtrl+P");
  });

  it("clears only through the clear button", async () => {
    wrapper = mount(KeybindInput, { props: { modelValue: "CmdOrCtrl+P", label: "Play/pause" } });
    const clear = wrapper.find("button.remove");
    expect(clear.attributes("aria-label")).toBe("Clear Play/pause shortcut");
    await clear.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[""]]);
  });

  it("labels the capture input with the action name", () => {
    wrapper = mount(KeybindInput, { props: { modelValue: "", label: "Next" } });
    expect(wrapper.find("input").attributes("aria-label")).toBe("Next");
  });

  it("puts a long binding in a tooltip as well as the truncated text", () => {
    const binding = "CommandOrControl+Alt+Shift+F12";
    wrapper = mount(KeybindInput, { props: { modelValue: binding } });
    expect(wrapper.find(".keybind-text").attributes("title")).toBe(binding);
  });
});
