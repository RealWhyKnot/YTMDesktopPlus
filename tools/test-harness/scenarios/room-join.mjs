// Joins a live Listen Along room hosted by an in-scenario bot and verifies the
// app follows it end to end: settings opens the room window, the join form
// takes a code, the relay roster shows the app's display name, and playback
// cues the host's track. Local use, not suited to CI runners: it reaches the
// production relay at ytmdesktopplus.com and depends on signed-out playback.

import WebSocket from "ws";

export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false
  },
  integrations: {
    companionServerEnabled: false,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false,
    listenAlongEnabled: false,
    listenAlongHost: null,
    listenAlongHostPort: 9863,
    listenAlongToken: null,
    listenAlongRoomsEnabled: true,
    listenAlongDisplayName: "Harness Listener"
  }
};

const VIDEO_ID = "dQw4w9WgXcQ";
const SETTINGS_WINDOW = /windows\/settings\//;
const ROOM_WINDOW = /windows\/room\//;

export default async function roomJoin(ctx) {
  const bot = { socket: null, roomId: null, roster: [] };

  await ctx.step(
    "bot hosts a live room",
    () =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket("wss://ytmdesktopplus.com/relay");
        bot.socket = socket;
        const timer = setTimeout(() => reject(new Error("bot host timeout")), 15000);
        socket.on("message", data => {
          const frame = JSON.parse(data.toString("utf8"));
          if (frame.t === "r" && frame.k) {
            bot.roomId = frame.r;
            socket.send(JSON.stringify({ t: "s", v: VIDEO_ID, a: Date.now() - 30_000, p: 1 }));
            clearTimeout(timer);
            resolve();
          }
          if (frame.t === "m") bot.roster = frame.members;
        });
        socket.on("open", () => socket.send(JSON.stringify({ t: "h", d: "E2E Host Bot" })));
        socket.on("error", reject);
      }),
    20000
  );

  try {
    await ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

    await ctx.step(
      "room window opens from settings",
      async () => {
        await ctx.evalMain("window.ytmd.openSettingsWindow()");
        await ctx.waitTarget(SETTINGS_WINDOW, 15000);
        await ctx.waitOnTarget(SETTINGS_WINDOW, "typeof window.ytmd?.openRoomWindow", kind => kind === "function", 15000);
        await ctx.evalOnTarget(SETTINGS_WINDOW, "window.ytmd.openRoomWindow()");
        await ctx.waitTarget(ROOM_WINDOW, 15000);
      },
      40000
    );

    await ctx.step(
      "join form takes the code",
      async () => {
        // The Vue app mounts once its store reads resolve.
        await ctx.waitOnTarget(ROOM_WINDOW, "document.querySelectorAll('input').length", count => Number(count) >= 2, 20000);

        const fill = `(() => {
          const inputs = [...document.querySelectorAll("input")];
          const join = inputs[inputs.length - 1];
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(join, "${bot.roomId}");
          join.dispatchEvent(new Event("input", { bubbles: true }));
          return join.value;
        })()`;
        const filled = await ctx.evalOnTarget(ROOM_WINDOW, fill);
        if (filled !== bot.roomId) throw new Error(`join input holds ${filled}`);

        await ctx.waitOnTarget(
          ROOM_WINDOW,
          `(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Join"); return b ? !b.disabled : null; })()`,
          enabled => enabled === true,
          10000
        );
        await ctx.evalOnTarget(ROOM_WINDOW, `[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Join").click()`);
      },
      40000
    );

    await ctx.step(
      "room window shows the joined room",
      () => ctx.waitOnTarget(ROOM_WINDOW, "document.body.innerText", text => typeof text === "string" && text.includes(bot.roomId), 30000),
      35000
    );

    await ctx.step(
      "bot roster shows the app's display name",
      async () => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          if (bot.roster.some(member => member.d === "Harness Listener")) return;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`roster never carried the app: ${JSON.stringify(bot.roster)}`);
      },
      35000
    );

    await ctx.step(
      "app follows the host's track",
      () =>
        ctx.waitYtm(
          `document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerResponse?.()?.videoDetails?.videoId ?? null`,
          videoId => videoId === VIDEO_ID,
          120000
        ),
      125000
    );
  } finally {
    bot.socket?.close();
  }
}
