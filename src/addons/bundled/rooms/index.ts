import { isRoomId, isRoomLive, otherListenerCount, type RoomSnapshot } from "~shared/room-protocol";
import type { BundledAddonDefinition } from "../../../main/addons/manager";
import type { AddonWindowHandle } from "../../../main/addons/context";
import AudioStreamCapture from "./audio-capture";
import { AudioPublisher, AudioRelayClient } from "../../../main/integrations/listen-along/audio-publisher";
import { AutoRoom } from "../../../main/integrations/listen-along/auto-room";
import { RelayClient } from "../../../main/integrations/listen-along/relay-client";
import { RoomSession } from "../../../main/integrations/listen-along/room-session";
import { registerRoomIpc } from "./ipc";
import { setAudioSink } from "./audio-sink";

// Listen Along rooms as a bundled addon: hosting and joining relay rooms, the
// audio stream to browser listeners, the automatic room that follows Discord
// presence, and the room window. Disabling the addon means none of this is
// constructed, so the app never touches the relay.
const roomsAddon: BundledAddonDefinition = {
  manifest: {
    id: "rooms",
    name: "Listen Along rooms",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Host or join Listen Along rooms so friends can hear your playback live, in the app or in a browser.",
    defaultEnabled: true
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
            description: "Shown to people in your rooms. You choose it; it is never taken from your account"
          },
          {
            key: "audioStreamEnabled",
            type: "toggle",
            label: "Stream audio to web listeners",
            description: "While you host a room, people who open your room link in a browser hear your playback live. Uses some upload bandwidth"
          },
          {
            key: "autoRoomEnabled",
            type: "toggle",
            label: "Open a room automatically with Discord presence",
            description:
              "While your presence is on, a room stays open so anyone who sees your profile can listen along, with your audio if web streaming is on. Turn off to only share rooms you start yourself"
          }
        ]
      }
    ]);

    // The capture scripts live under this addon's script namespace; the
    // capture class runs them through the same channel it registered on.
    const audioStreamCapture = new AudioStreamCapture(name => ctx.ytmview.runScript(name));
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

    // The title bar indicator mirrors the room state; identical states are
    // not republished so snapshots do not spam every window.
    let lastBadgeJson = "null";
    const updateBadge = (snapshot: RoomSnapshot) => {
      let badge: { icon: string; text?: string; tooltip?: string; active?: boolean } | null = null;
      if (isRoomLive(snapshot)) {
        const count = otherListenerCount(snapshot);
        badge = {
          icon: "headphones",
          text: count > 0 ? String(count) : undefined,
          tooltip: count === 0 ? "Room is open, nobody listening yet" : count === 1 ? "1 person listening along" : `${count} people listening along`,
          active: count > 0
        };
      }
      const json = JSON.stringify(badge);
      if (json === lastBadgeJson) return;
      lastBadgeJson = json;
      ctx.titlebar.setBadge(badge);
    };

    // One relay room at a time, hosted or joined. Opens a connection only
    // when the user starts or joins a room.
    const roomSession = new RoomSession({
      createClient: handlers => new RelayClient(handlers),
      cueTrack: request => ctx.playback.cueTrack(request),
      sendCommand: (command, value) => ctx.playback.sendPlaybackCommand(command, value),
      publish: snapshot => {
        ctx.memory.set("room", snapshot);
        // The Join Room presence button follows the hosting state.
        ctx.discord.refreshActivity();
        syncAudioPublisher();
        // A left or expired room grows back while presence is shared.
        autoRoom.evaluate();
        updateBadge(snapshot);
      },
      getPlayerState: () => ctx.player.getState(),
      now: () => Date.now()
    });
    ctx.memory.set("room", roomSession.snapshot);

    // Streams the host's audio to browser listeners while a room is hosted.
    // The capture runs in the YTM page; this owns the socket and send gates.
    const audioPublisher = new AudioPublisher({
      createTransport: (url, handlers) => new AudioRelayClient(url, handlers),
      startCapture: () => audioStreamCapture.enable(),
      stopCapture: () => audioStreamCapture.disable(),
      onUpdate: ({ streaming, webListeners }) => roomSession.setAudioStreamState(streaming, webListeners),
      now: () => Date.now(),
      log: (message, ...args) => ctx.log.info(message, ...args)
    });

    // Idempotent: called on every room snapshot and on the toggle changing.
    function syncAudioPublisher() {
      const enabled = ctx.settings.get<boolean>("audioStreamEnabled");
      audioPublisher.setCredentials(enabled ? roomSession.hostCredentials : null);
    }

    // While Discord presence is shared, a room exists without being started,
    // so the presence link always has somewhere to land.
    let autoRoomNotified = false;
    const autoRoom = new AutoRoom({
      enabled: () => ctx.discord.isEnabled() && ctx.settings.get<boolean>("autoRoomEnabled"),
      phase: () => roomSession.snapshot.phase,
      savedDisplayName: () => ctx.settings.get<string | null>("displayName") ?? null,
      host: displayName => {
        roomSession.host(displayName);
        // Said out loud once per session: a shareable live surface just opened
        // without a click, and that should never be a surprise.
        if (!autoRoomNotified) {
          autoRoomNotified = true;
          ctx.notifications.show({
            title: "Listen Along room opened",
            body: "Discord presence is on, so your room link is live. Anyone with it can listen along, including in a browser. Manage this in Settings.",
            onClick: () => openOrShowWindow()
          });
        }
      },
      leave: () => roomSession.leave()
    });

    ctx.player.onStateChanged(state => {
      roomSession.updateLocalState(state);
      audioPublisher.updateLocalState(state);
    });

    ctx.settings.onDidChange("audioStreamEnabled", next => {
      syncAudioPublisher();
      ctx.log.info(`Audio stream ${next ? "enabled" : "disabled"}`);
    });
    ctx.settings.onDidChange("autoRoomEnabled", () => autoRoom.syncToggles());
    ctx.discord.onEnabledChanged(() => autoRoom.syncToggles());

    ctx.discord.registerButtonsProvider(trackShareUrl => {
      const room = ctx.memory.get<RoomSnapshot | null>("room");
      if (!room || room.phase !== "hosting" || !room.shareUrl) return undefined;
      return [
        { label: "Join Room", url: room.shareUrl },
        { label: "Listen Along", url: trackShareUrl }
      ];
    });

    ctx.deepLinks.register("room", segments => {
      if (segments.length !== 1 || !isRoomId(segments[0])) return;
      ctx.memory.set("joinPrompt", segments[0]);
      openOrShowWindow();
    });

    ctx.titlebar.onBadgeClick(() => openOrShowWindow());
    ctx.tray.setMenuItems([{ label: "Listen Along", click: () => openOrShowWindow() }]);

    ctx.ytmview.onLoaded(() => {
      audioStreamCapture.ytmViewLoaded();
      // A room opens with the app while presence is shared, so the profile
      // buttons and the web link work without anyone touching the room window.
      autoRoom.evaluate();
    });

    setAudioSink({
      handleChunks: packets => audioPublisher.handleChunks(packets),
      handleCaptureStatus: status => audioPublisher.handleCaptureStatus(status)
    });

    const unregisterIpc = registerRoomIpc({
      roomWindowContents: () => windowHandle?.webContents() ?? null,
      openWindow: openOrShowWindow,
      closeWindow: () => windowHandle?.close(),
      host: name => {
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
        // Leaving a room you host is a choice; automation respects it for
        // the rest of the session instead of instantly reopening one.
        autoRoom.noteManualLeave(roomSession.snapshot.isHost);
        roomSession.leave();
      },
      grant: (memberId, role) => roomSession.grant(memberId, role),
      control: (action, value) => roomSession.control(action, value),
      resume: () => roomSession.resume()
    });

    return {
      destroy() {
        unregisterIpc();
        setAudioSink(null);
        roomSession.leave();
        windowHandle?.close();
      }
    };
  }
};

export default roomsAddon;
