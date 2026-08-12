import { CONTROL_ACTIONS, isRoomId, sanitizeDisplayName, type ControlAction, type RoomRole } from "~shared/room-protocol";
import type { AddonContext, AddonWebContents } from "~shared/addons/sdk";

export type RoomIpcDeps = {
  roomWindowContents(): AddonWebContents | null;
  openWindow(): void;
  closeWindow(): void;
  host(displayName: string): void;
  join(roomId: string, displayName: string): void;
  leave(): void;
  grant(memberId: string, role: RoomRole): void;
  control(action: ControlAction, value?: number | string): void;
  resume(): void;
};

// The room window's channels ride the addon's namespaced ipc like any other
// addon window's. The addon being active is the master gate, registration is
// unwound with the addon, and the mutating channels additionally require the
// sender to be the room window itself.
export function registerRoomIpc(ipc: AddonContext["ipc"], deps: RoomIpcDeps): void {
  const isRoomSender = (sender: AddonWebContents) => {
    const contents = deps.roomWindowContents();
    return contents !== null && sender === contents;
  };

  // Any window may ask; this only opens or focuses the room window.
  ipc.on("openWindow", () => deps.openWindow());

  ipc.on("host", (event, displayName) => {
    if (!isRoomSender(event.sender)) return;
    const name = sanitizeDisplayName(displayName as string);
    if (!name) return;

    deps.host(name);
  });

  ipc.on("join", (event, roomId, displayName) => {
    if (!isRoomSender(event.sender)) return;
    const name = sanitizeDisplayName(displayName as string);
    if (!name || typeof roomId !== "string" || !isRoomId(roomId)) return;

    deps.join(roomId, name);
  });

  ipc.on("leave", event => {
    if (!isRoomSender(event.sender)) return;

    deps.leave();
  });

  ipc.on("grant", (event, memberId, role) => {
    if (!isRoomSender(event.sender)) return;
    if (typeof memberId !== "string" || (role !== 0 && role !== 1)) return;

    deps.grant(memberId, role as RoomRole);
  });

  ipc.on("control", (event, action, value) => {
    if (!isRoomSender(event.sender)) return;
    if (!CONTROL_ACTIONS.includes(action as ControlAction)) return;

    deps.control(action as ControlAction, value as number | string | undefined);
  });

  ipc.on("resume", event => {
    if (!isRoomSender(event.sender)) return;

    deps.resume();
  });

  ipc.on("closeWindow", event => {
    if (!isRoomSender(event.sender)) return;

    deps.closeWindow();
  });
}
