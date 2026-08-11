import { ipcMain, type IpcMainEvent } from "electron";
import { CONTROL_ACTIONS, isRoomId, sanitizeDisplayName, type ControlAction, type RoomRole } from "~shared/room-protocol";

export type RoomIpcDeps = {
  roomWindowContents(): Electron.WebContents | null;
  openWindow(): void;
  closeWindow(): void;
  host(displayName: string): void;
  join(roomId: string, displayName: string): void;
  leave(): void;
  grant(memberId: string, role: RoomRole): void;
  control(action: ControlAction, value?: number | string): void;
  resume(): void;
};

// The room window's channels keep their historical names so the preloads need
// no changes. They only exist while the addon is active, so the addon being
// loaded is the master gate; the mutating channels additionally require the
// sender to be the room window itself.
export function registerRoomIpc(deps: RoomIpcDeps): () => void {
  const isRoomSender = (sender: Electron.WebContents) => {
    const contents = deps.roomWindowContents();
    return contents !== null && sender === contents;
  };

  const listeners: [string, (event: IpcMainEvent, ...args: unknown[]) => void][] = [
    [
      "room:openWindow",
      // Any window may ask; this only opens or focuses the room window.
      () => deps.openWindow()
    ],
    [
      "room:host",
      (event, displayName) => {
        if (!isRoomSender(event.sender)) return;
        const name = sanitizeDisplayName(displayName as string);
        if (!name) return;

        deps.host(name);
      }
    ],
    [
      "room:join",
      (event, roomId, displayName) => {
        if (!isRoomSender(event.sender)) return;
        const name = sanitizeDisplayName(displayName as string);
        if (!name || typeof roomId !== "string" || !isRoomId(roomId)) return;

        deps.join(roomId, name);
      }
    ],
    [
      "room:leave",
      event => {
        if (!isRoomSender(event.sender)) return;

        deps.leave();
      }
    ],
    [
      "room:grant",
      (event, memberId, role) => {
        if (!isRoomSender(event.sender)) return;
        if (typeof memberId !== "string" || (role !== 0 && role !== 1)) return;

        deps.grant(memberId, role as RoomRole);
      }
    ],
    [
      "room:control",
      (event, action, value) => {
        if (!isRoomSender(event.sender)) return;
        if (!CONTROL_ACTIONS.includes(action as ControlAction)) return;

        deps.control(action as ControlAction, value as number | string | undefined);
      }
    ],
    [
      "room:resume",
      event => {
        if (!isRoomSender(event.sender)) return;

        deps.resume();
      }
    ],
    [
      "roomWindow:close",
      event => {
        if (!isRoomSender(event.sender)) return;

        deps.closeWindow();
      }
    ]
  ];

  for (const [channel, listener] of listeners) ipcMain.on(channel, listener);
  return () => {
    for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
  };
}
