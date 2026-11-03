import { describe, expect, it, vi } from "vitest";
import { applyLaunchVisibility, startsHidden } from "../src/main/windows/launch-visibility";

function fakeWindow() {
  const handlers = new Map<string, { fn: () => void; once: boolean }[]>();
  const add = (event: string, fn: () => void, isOnce: boolean) => handlers.set(event, [...(handlers.get(event) ?? []), { fn, once: isOnce }]);
  const window = {
    show: vi.fn(),
    maximize: vi.fn(),
    on: vi.fn((event: string, fn: () => void) => add(event, fn, false)),
    once: vi.fn((event: string, fn: () => void) => add(event, fn, true)),
  };
  const emit = (event: string) => {
    const list = handlers.get(event) ?? [];
    handlers.set(
      event,
      list.filter((handler) => !handler.once)
    );
    for (const handler of list) handler.fn();
  };
  return { window, emit };
}

describe("startsHidden", () => {
  it("hides only when the setting is on", () => {
    expect(startsHidden({ startMinimized: true }, "win32")).toBe(true);
    expect(startsHidden({ startMinimized: true }, "linux")).toBe(true);
    expect(startsHidden({ startMinimized: false }, "win32")).toBe(false);
    expect(startsHidden({}, "win32")).toBe(false);
  });

  it("never hides on macOS", () => {
    expect(startsHidden({ startMinimized: true }, "darwin")).toBe(false);
  });
});

describe("applyLaunchVisibility", () => {
  it("shows the window once it is ready", () => {
    const { window, emit } = fakeWindow();
    applyLaunchVisibility(window, { hidden: false, maximized: false });
    expect(window.show).not.toHaveBeenCalled();
    emit("ready-to-show");
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it("maximizes straight away when the window will be shown", () => {
    const { window, emit } = fakeWindow();
    applyLaunchVisibility(window, { hidden: false, maximized: true });
    expect(window.maximize).toHaveBeenCalledTimes(1);
    emit("ready-to-show");
    expect(window.show).toHaveBeenCalledTimes(1);
  });

  it("stays hidden when started minimized", () => {
    const { window, emit } = fakeWindow();
    applyLaunchVisibility(window, { hidden: true, maximized: false });
    emit("ready-to-show");
    expect(window.show).not.toHaveBeenCalled();
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it("waits for the first show to maximize a hidden window", () => {
    const { window, emit } = fakeWindow();
    applyLaunchVisibility(window, { hidden: true, maximized: true });
    emit("ready-to-show");
    expect(window.maximize).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    emit("show");
    expect(window.maximize).toHaveBeenCalledTimes(1);
    emit("show");
    expect(window.maximize).toHaveBeenCalledTimes(1);
  });
});
