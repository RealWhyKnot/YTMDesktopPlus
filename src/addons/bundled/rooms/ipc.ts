import { isControlAction, isRoomId, sanitizeDisplayName, type ControlAction, type RoomRole } from "~shared/room-protocol";
import type { AddonContext, AddonWebContents } from "~shared/addons/sdk";

export type RoomIpcDeps = {
  roomWindowContents(): AddonWebContents | null;
  openWindow(): void;
  closeWindow(): void;
  host(displayName: string): void;
  join(roomId: string, displayName: string): void;
  leave(): void;
  dismissJoinPrompt(): void;
  grant(memberId: string, role: RoomRole): void;
  control(action: ControlAction, value?: number | string): void;
  resume(): void;
};

export function registerRoomIpc(ipc: AddonContext["ipc"], deps: RoomIpcDeps): void {
  const isRoomSender = (sender: AddonWebContents) => {
    const contents = deps.roomWindowContents();
    return contents !== null && sender === contents;
  };

  ipc.on("openWindow", () => deps.openWindow());

  ipc.on("host", (event, displayName) => {
    if (!isRoomSender(event.sender)) return;
    const name = sanitizeDisplayName(displayName);
    if (!name) return;

    deps.host(name);
  });

  ipc.on("join", (event, roomId, displayName) => {
    if (!isRoomSender(event.sender)) return;
    const name = sanitizeDisplayName(displayName);
    if (!name || typeof roomId !== "string" || !isRoomId(roomId)) return;

    deps.join(roomId, name);
  });

  ipc.on("leave", (event) => {
    if (!isRoomSender(event.sender)) return;

    deps.leave();
  });

  ipc.on("dismissJoinPrompt", (event) => {
    if (!isRoomSender(event.sender)) return;

    deps.dismissJoinPrompt();
  });

  ipc.on("grant", (event, memberId, role) => {
    if (!isRoomSender(event.sender)) return;
    if (typeof memberId !== "string" || (role !== 0 && role !== 1)) return;

    deps.grant(memberId, role);
  });

  ipc.on("control", (event, action, value) => {
    if (!isRoomSender(event.sender)) return;
    if (!isControlAction(action)) return;
    if (value !== undefined && typeof value !== "number" && typeof value !== "string") return;

    deps.control(action, value);
  });

  ipc.on("resume", (event) => {
    if (!isRoomSender(event.sender)) return;

    deps.resume();
  });

  ipc.on("closeWindow", (event) => {
    if (!isRoomSender(event.sender)) return;

    deps.closeWindow();
  });
}
