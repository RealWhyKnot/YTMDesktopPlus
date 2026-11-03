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

  it.each([
    { key: "ф", code: "KeyA", keyCode: 65, ctrlKey: true, expected: "CmdOrCtrl+ф" },
    { key: "s", code: "Semicolon", keyCode: 83, altKey: true, expected: "Alt+S" },
    { key: "é", code: "Digit2", keyCode: 50, ctrlKey: true, expected: "CmdOrCtrl+é" },
    { key: "@", code: "KeyQ", keyCode: 81, ctrlKey: true, altKey: true, expected: "CmdOrCtrl+Alt+@" },
    { key: "P", code: "KeyP", keyCode: 80, metaKey: true, shiftKey: true, expected: "Meta+Shift+P" },
    { key: "Dead", code: "KeyQ", keyCode: 81, expected: "Dead" },
    { key: "Dead", code: "KeyQ", keyCode: 222, expected: "Dead" },
    { key: "=", code: "Equal", keyCode: 187, shiftKey: true, expected: "Shift+Plus" },
    { key: "i", code: "Quote", keyCode: 222, ctrlKey: true, expected: "CmdOrCtrl+I" },
    { key: "İ", code: "Quote", keyCode: 222, ctrlKey: true, shiftKey: true, expected: "CmdOrCtrl+Shift+İ" },
  ])("maps $key on $code with virtual code $keyCode", async ({ expected, ...event }) => {
    wrapper = mount(KeybindInput, { props: { modelValue: "" } });
    await wrapper.find("input").trigger("keydown", event);
    expect(wrapper.emitted("update:modelValue")).toEqual([[expected]]);
  });

  it.each([
    { layout: "US", key: "a", code: "KeyA", keyCode: 65, letter: "A" },
    { layout: "AZERTY A", key: "a", code: "KeyQ", keyCode: 65, letter: "A" },
    { layout: "AZERTY M", key: "m", code: "Semicolon", keyCode: 77, letter: "M" },
    { layout: "Turkish dotless I", key: "ı", code: "KeyI", keyCode: 73, letter: "I" },
    { layout: "Russian", key: "ф", code: "KeyA", keyCode: 65, letter: "ф" },
    { layout: "Polish AltGr+A", key: "ą", code: "KeyA", keyCode: 65, letter: "ą", altKey: true },
  ])("records $layout letters with Ctrl and Shift", async ({ key, code, keyCode, letter, altKey }) => {
    wrapper = mount(KeybindInput, { props: { modelValue: "" } });
    await wrapper.find("input").trigger("keydown", { key, code, keyCode, ctrlKey: true, altKey });
    await wrapper.find("input").trigger("keydown", { key: key.toUpperCase(), code, keyCode, ctrlKey: true, shiftKey: true, altKey });
    const prefix = altKey ? "CmdOrCtrl+Alt+" : "CmdOrCtrl+";
    expect(wrapper.emitted("update:modelValue")).toEqual([[`${prefix}${letter}`], [`${prefix}Shift+${letter.toUpperCase()}`]]);
  });

  it("cancels the edit on Escape and keeps the binding", async () => {
    wrapper = mount(KeybindInput, { props: { modelValue: "CmdOrCtrl+P", label: "Play/pause" }, attachTo: document.body });
    const input = wrapper.find("input");
    (input.element as HTMLInputElement).focus();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".keybind").attributes("data-editing")).toBe("true");

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
