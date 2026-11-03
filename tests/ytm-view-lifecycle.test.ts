import { EventEmitter } from "node:events";
import { BrowserWindow, type WebContentsViewConstructorOptions } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachYtmView, createYtmContentsView, detachYtmView, installYtmViewLifecycle } from "../src/main/windows/ytm-view-lifecycle";
import { requireValue } from "./helpers/require-value";

const mocks = vi.hoisted(() => ({
  windows: new Array<EventEmitter & { contentView: { addChildView: ReturnType<typeof vi.fn>; removeChildView: ReturnType<typeof vi.fn> } }>(),
  views: new Array<{
    options: WebContentsViewConstructorOptions;
    webContents: EventEmitter & { close: ReturnType<typeof vi.fn>; isDestroyed: ReturnType<typeof vi.fn>; _setOwnerWindow: ReturnType<typeof vi.fn> };
  }>(),
}));

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    BrowserWindow: class extends Emitter {
      contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
      constructor() {
        super();
        mocks.windows.push(this);
      }
    },
    WebContentsView: class {
      readonly options: WebContentsViewConstructorOptions;
      webContents = Object.assign(new Emitter(), { close: vi.fn(), isDestroyed: vi.fn(() => false), _setOwnerWindow: vi.fn() });
      constructor(options: WebContentsViewConstructorOptions) {
        this.options = options;
        mocks.views.push(this);
      }
    },
  };
});

function fixture() {
  const window = new BrowserWindow({ show: false });
  installYtmViewLifecycle(window);
  const view = createYtmContentsView({ webPreferences: { sandbox: true, partition: "persist:fixture" } });
  return { window, view, windowMock: requireValue(mocks.windows.at(-1)), viewMock: requireValue(mocks.views.at(-1)) };
}

beforeEach(() => {
  mocks.windows.length = 0;
  mocks.views.length = 0;
});

describe("YTM view lifecycle", () => {
  it("keeps the page preferences and the BrowserView web contents type", () => {
    const { viewMock } = fixture();
    expect(viewMock.options).toEqual({ webPreferences: { sandbox: true, partition: "persist:fixture", type: "browserView" } });
  });

  it("attaches once across repeated loaded events and closes the attached page with the window", () => {
    const { window, view, windowMock, viewMock } = fixture();
    attachYtmView(window, view);
    attachYtmView(window, view);
    expect(windowMock.contentView.addChildView.mock.calls).toEqual([[view]]);
    expect(viewMock.webContents._setOwnerWindow.mock.calls).toEqual([[window]]);
    windowMock.emit("closed");
    expect(viewMock.webContents.close.mock.calls).toEqual([[{ waitForBeforeUnload: true }]]);
  });

  it("detaches and clears ownership before recreation without closing the detached page later", () => {
    const { window, view, windowMock, viewMock } = fixture();
    attachYtmView(window, view);
    detachYtmView(window, view);
    detachYtmView(window, view);
    expect(windowMock.contentView.removeChildView.mock.calls).toEqual([[view]]);
    expect(viewMock.webContents._setOwnerWindow.mock.calls).toEqual([[window], [null]]);
    windowMock.emit("closed");
    expect(viewMock.webContents.close).not.toHaveBeenCalled();
  });

  it("removes a destroyed page from the view hierarchy", () => {
    const { window, view, windowMock, viewMock } = fixture();
    attachYtmView(window, view);
    viewMock.webContents.emit("destroyed");
    expect(windowMock.contentView.removeChildView.mock.calls).toEqual([[view]]);
  });

  it.each([null, undefined])("detaches after native contents become %s", (contents) => {
    const { window, view, windowMock } = fixture();
    attachYtmView(window, view);
    Object.defineProperty(view, "webContents", { value: contents });
    expect(() => detachYtmView(window, view)).not.toThrow();
    expect(() => windowMock.emit("closed")).not.toThrow();
  });

  it.each([null, undefined])("closes an owner after attached contents become %s", (contents) => {
    const { window, view, windowMock } = fixture();
    attachYtmView(window, view);
    Object.defineProperty(view, "webContents", { value: contents });
    expect(() => windowMock.emit("closed")).not.toThrow();
  });

  it("moves the same view between owners and closes it only with its current window", () => {
    const first = fixture();
    const second = fixture();
    attachYtmView(first.window, first.view);
    attachYtmView(second.window, first.view);
    expect(first.windowMock.contentView.removeChildView.mock.calls).toEqual([[first.view]]);
    expect(second.windowMock.contentView.addChildView.mock.calls).toEqual([[first.view]]);
    first.windowMock.emit("closed");
    expect(first.viewMock.webContents.close).not.toHaveBeenCalled();
    second.windowMock.emit("closed");
    expect(first.viewMock.webContents.close.mock.calls).toEqual([[{ waitForBeforeUnload: true }]]);
  });
});
