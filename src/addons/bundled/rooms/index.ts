import { isRoomId, isRoomLive, otherListenerCount, relayUrlFor, type RoomSnapshot } from "~shared/room-protocol";
import { isRecord } from "~shared/unknown";
import type { BundledAddonDefinition } from "../../../main/addons/managed-addon";
import type { AddonWindowHandle } from "~shared/addons/sdk";
import { AudioStreamCapture } from "./audio-capture";
import { AutoRoom } from "../../../main/integrations/listen-along/auto-room";
import { RelayClient } from "../../../main/integrations/listen-along/relay-client";
import { RoomSession } from "../../../main/integrations/listen-along/room-session";
import { registerRoomIpc } from "./ipc";
import { mediaHost } from "../../../main/media/media-host";
import { AudioUplink, forkAudioUplink } from "../../../main/media/audio-uplink";
import { onSystemResume } from "../../../main/integrations/listen-along/system-resume";
import { cancelCue } from "../../../main/playback";

const roomsAddon = {
  manifest: {
    id: "rooms",
    name: "Listen Along rooms",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Host or join Listen Along rooms so friends can hear your playback live, in the app or in a browser.",
    defaultEnabled: true,
  },

  activate(ctx) {
    ctx.settings.registerDefaults({ displayName: null, audioStreamEnabled: true, autoRoomEnabled: true });
    ctx.settings.registerSettingsUI([
      {
        fields: [
          {
            key: "displayName",
            type: "text",
            label: "Room display name",
            maxlength: 24,
            placeholder: "Not set",
            description: "Shown to people in your rooms. You choose it; it is never taken from your account",
          },
          {
            key: "audioStreamEnabled",
            type: "toggle",
            label: "Stream audio to web listeners",
            description: "While you host a room, people who open your room link in a browser hear your playback live. Uses some upload bandwidth",
          },
          {
            key: "autoRoomEnabled",
            type: "toggle",
            label: "Open a room automatically with Discord presence",
            description:
              "While your presence is on, a room stays open so anyone who sees your profile can listen along, with your audio if web streaming is on. Turn off to only share rooms you start yourself",
          },
        ],
      },
    ]);

    const audioStreamCapture = new AudioStreamCapture((name) => ctx.ytmview.runScript(name), {
      start: () => mediaHost.start({ onStatus: (status) => audioUplink.handleCaptureStatus(status) }),
      stop: () => mediaHost.stop(),
    });
    for (const { name, script } of audioStreamCapture.getYTMScripts()) {
      ctx.ytmview.registerScript(name, script);
    }

    let windowHandle: AddonWindowHandle | null = null;
    const openOrShowWindow = () => {
      if (windowHandle?.isOpen()) {
        windowHandle.show();
        return;
      }
      windowHandle = ctx.windows.create({ entry: "room", width: 400, height: 600 });
    };

    let lastBadgeJson = "null";
    const updateBadge = (snapshot: RoomSnapshot) => {
      let badge: { icon: string; text?: string; tooltip?: string; active?: boolean } | null = null;
      if (isRoomLive(snapshot)) {
        const count = otherListenerCount(snapshot);
        badge = {
          icon: "headphones",
          text: count > 0 ? String(count) : undefined,
          tooltip: count === 0 ? "Room is open, nobody listening yet" : count === 1 ? "1 person listening along" : `${count} people listening along`,
          active: count > 0,
        };
      }
      const json = JSON.stringify(badge);
      if (json === lastBadgeJson) return;
      lastBadgeJson = json;
      ctx.titlebar.setBadge(badge);
    };

    const roomSession = new RoomSession({
      createClient: (handlers, roomId) => new RelayClient(handlers, relayUrlFor(roomId)),
      cueTrack: (request) => ctx.playback.cueTrack(request),
      sendCommand: (command, value) => ctx.playback.sendPlaybackCommand(command, value),
      publish: (snapshot) => {
        ctx.memory.set("room", snapshot);

        ctx.discord.refreshActivity();
        syncAudioUplink();

        autoRoom.evaluate();
        updateBadge(snapshot);
      },
      getPlayerState: () => ctx.player.getState(),
      now: () => Date.now(),
      log: (message) => ctx.log.info(message),
      cancelCue: () => cancelCue(),
    });
    ctx.memory.set("room", roomSession.snapshot);

    const audioUplink = new AudioUplink({
      fork: forkAudioUplink,
      connectMediaHost: (send) => mediaHost.connectUplink(send),
      setCapture: (isOn) => (isOn ? audioStreamCapture.enable() : audioStreamCapture.disable()),
      onUpdate: ({ streaming, webListeners, issue }) => {
        audioStreamCapture.setListening(streaming && webListeners > 0);
        roomSession.setAudioStreamState(streaming, webListeners, issue);
      },
      now: () => Date.now(),
      log: (message, ...args) => ctx.log.info(message, ...args),
    });

    let wasHosting = false;
    function syncAudioUplink() {
      const isEnabled = Boolean(ctx.settings.get("audioStreamEnabled"));
      audioUplink.setClockOffset(roomSession.serverClockOffsetMs);
      audioUplink.setCredentials(isEnabled ? roomSession.hostCredentials : null);
      const isHosting = roomSession.snapshot.phase === "hosting";
      if (isHosting && !wasHosting) audioUplink.rearm();
      wasHosting = isHosting;
    }

    const stopResumeWatch = onSystemResume(() => {
      ctx.log.info("System resumed, reconnecting the room");
      roomSession.reconnectNow();
      audioUplink.reconnectNow();
    });

    let isAutoRoomNotified = false;
    const autoRoom = new AutoRoom({
      enabled: () => ctx.discord.isEnabled() && Boolean(ctx.settings.get("autoRoomEnabled")),
      phase: () => roomSession.snapshot.phase,
      isHost: () => roomSession.snapshot.isHost,
      savedDisplayName: () => {
        const name = ctx.settings.get("displayName");
        return typeof name === "string" ? name : null;
      },
      host: (displayName) => {
        roomSession.host(displayName);

        if (!isAutoRoomNotified) {
          isAutoRoomNotified = true;
          ctx.notifications.show({
            title: "Listen Along room opened",
            body: "Discord presence is on, so your room link is live. Anyone with it can listen along, including in a browser. Manage this in Settings.",
            onClick: () => openOrShowWindow(),
          });
        }
      },
      leave: () => roomSession.leave(),
      log: (message) => ctx.log.info(message),
    });

    ctx.player.onStateChanged((state) => {
      roomSession.updateLocalState(state);
      audioUplink.updateLocalState(state);
    });

    ctx.settings.onDidChange("audioStreamEnabled", (next) => {
      syncAudioUplink();
      ctx.log.info(`Audio stream ${next ? "enabled" : "disabled"}`);
    });
    ctx.settings.onDidChange("autoRoomEnabled", () => autoRoom.syncToggles());
    ctx.discord.onEnabledChanged(() => autoRoom.syncToggles());

    ctx.discord.registerButtonsProvider(() => {
      const room = ctx.memory.get("room");
      if (!isRecord(room) || room.phase !== "hosting" || typeof room.shareUrl !== "string" || !room.shareUrl) return undefined;
      return [{ label: "Listen Along", url: room.shareUrl }];
    });

    ctx.deepLinks.register("room", (segments) => {
      if (segments.length !== 1 || !isRoomId(segments[0])) return;
      ctx.memory.set("joinPrompt", segments[0]);
      openOrShowWindow();
    });

    ctx.titlebar.onBadgeClick(() => openOrShowWindow());
    ctx.tray.setMenuItems([{ label: "Listen Along", click: () => openOrShowWindow() }]);

    ctx.ytmview.onLoaded(() => {
      audioStreamCapture.ytmViewLoaded();

      autoRoom.evaluate();
    });

    ctx.ytmview.onMessage("captureStatus", (status) => {
      if (typeof status !== "object" || status === null) return;
      audioUplink.handleCaptureStatus(status);
    });

    registerRoomIpc(ctx.ipc, {
      roomWindowContents: () => windowHandle?.webContents() ?? null,
      openWindow: openOrShowWindow,
      closeWindow: () => windowHandle?.close(),
      host: (name) => {
        ctx.settings.set("displayName", name);
        autoRoom.noteManualSession();
        roomSession.host(name);
      },
      join: (roomId, name) => {
        ctx.settings.set("displayName", name);
        ctx.memory.set("joinPrompt", null);
        autoRoom.noteManualSession();
        roomSession.join(roomId, name);
      },
      leave: () => {
        autoRoom.noteManualLeave(roomSession.snapshot.isHost);
        roomSession.leave();
      },
      dismissJoinPrompt: () => ctx.memory.set("joinPrompt", null),
      grant: (memberId, role) => roomSession.grant(memberId, role),
      control: (action, value) => roomSession.control(action, value),
      resume: () => roomSession.resume(),
    });

    return {
      destroy() {
        stopResumeWatch();
        autoRoom.dispose();
        roomSession.leave();
        windowHandle?.close();
      },
    };
  },
} satisfies BundledAddonDefinition;

export { roomsAddon };
