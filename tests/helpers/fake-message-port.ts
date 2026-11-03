import { EventEmitter } from "node:events";
import type { MessagePortMain } from "electron";
import { vi } from "vitest";

export function fakeMessagePort() {
  return Object.assign(new EventEmitter(), {
    postMessage: vi.fn<MessagePortMain["postMessage"]>(),
    start: vi.fn<() => void>(),
    close: vi.fn<() => void>(),
  }) satisfies MessagePortMain;
}
