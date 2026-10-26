import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import ThemesTab from "../../src/renderer/windows/settings/tabs/ThemesTab.vue";
import { settingsShellKey } from "../../src/renderer/windows/settings/context";
import type { ThemeDescriptor } from "~shared/themes/sdk";

function mountTab(themeError: string | null, themes: ThemeDescriptor[] = []) {
  const shell = { themes: ref(themes), themeError: ref(themeError) };
  return mount(ThemesTab, { global: { provide: { [settingsShellKey as symbol]: shell } } });
}

describe("ThemesTab", () => {
  it("shows a theme error as a sentence", () => {
    expect(mountTab("the archive is empty").find(".theme-error-text").text()).toBe("The archive is empty.");
    expect(mountTab("that did not work").find(".theme-error-text").text()).toBe("That did not work.");
    expect(mountTab("Already a sentence.").find(".theme-error-text").text()).toBe("Already a sentence.");
  });

  it("keeps a long zip entry name inside the wrapping error text", () => {
    const entry = `themes/${"nested-folder/".repeat(40)}file.exe`;
    const wrapper = mountTab(`the archive holds a file type themes may not carry: ${entry}`);
    expect(wrapper.find(".theme-error-text").text()).toBe(`The archive holds a file type themes may not carry: ${entry}.`);
    expect(wrapper.find(".theme-error").attributes("role")).toBe("alert");
  });

  it("formats broken theme errors the same way", () => {
    const broken = {
      manifest: { id: "bad", name: "Bad theme", version: "1.0.0", author: "a", description: "d" },
      origin: "external",
      active: false,
      state: "error",
      error: "theme.json is invalid: name is missing",
      warnings: [],
      swatch: [],
      watching: false
    } as unknown as ThemeDescriptor;
    expect(mountTab(null, [broken]).find(".broken-text").text()).toBe("Bad theme Theme.json is invalid: name is missing.");
  });
});
