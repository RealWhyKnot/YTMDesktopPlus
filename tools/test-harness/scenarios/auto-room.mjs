// Verifies that a room exists without anyone starting one when Discord
// presence is enabled: the app boots, hosts automatically, and a browser bot
// can subscribe to the room's audio channel. Local use, not suited to CI
// runners: production relay, live YTM, and if Discord is running the app's
// presence will briefly show the test track.

import WebSocket from "ws";

export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false,
    loudnessNormalization: false
  },
  integrations: {
    companionServerEnabled: false,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: true,
    lastFMEnabled: false,
    listenAlongEnabled: false,
    listenAlongHost: null,
    listenAlongHostPort: 9863,
    listenAlongToken: null,
    listenAlongRoomsEnabled: true,
    listenAlongDisplayName: null,
    listenAlongAudioStreamEnabled: true,
    listenAlongAutoRoomEnabled: true
  }
};

const SETTINGS_WINDOW = /windows\/settings\//;
const ROOM_WINDOW = /windows\/room\//;

export default async function autoRoom(ctx) {
  await ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

  await ctx.step(
    "the title bar indicator appears and opens the room",
    async () => {
      await ctx.waitMain("!!document.querySelector('.badge-button')", present => present === true, 45000);
      const label = await ctx.evalMain("document.querySelector('.badge-button').title");
      if (!/Room is open|listening along/.test(label)) throw new Error(`unexpected indicator title: ${label}`);
      await ctx.evalMain("document.querySelector('.badge-button').click()");
      await ctx.waitTarget(ROOM_WINDOW, 15000);
    },
    60000
  );

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

  let roomId = null;
  await ctx.step(
    "a room exists without being started",
    async () => {
      await ctx.waitOnTarget(
        ROOM_WINDOW,
        "document.querySelector('.room-code')?.textContent ?? null",
        code => typeof code === "string" && /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(code.trim()),
        45000
      );
      roomId = (await ctx.evalOnTarget(ROOM_WINDOW, "document.querySelector('.room-code').textContent")).trim();
      const hosting = await ctx.evalOnTarget(ROOM_WINDOW, "document.body.innerText.includes('You are hosting')");
      if (hosting !== true) throw new Error("room window does not show hosting");
      ctx.emit("probe", { roomId });
    },
    60000
  );

  await ctx.step(
    "a browser bot can subscribe to the room's audio channel",
    () =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`wss://ytmdesktopplus.com/audio/${roomId}`);
        const timer = setTimeout(() => reject(new Error("no ready frame")), 15000);
        socket.on("message", data => {
          const frame = JSON.parse(data.toString("utf8"));
          if (frame.t === "ready") {
            clearTimeout(timer);
            socket.close();
            resolve();
          }
          if (frame.t === "e") {
            clearTimeout(timer);
            socket.close();
            reject(new Error(`relay refused: ${frame.m}`));
          }
        });
        socket.on("open", () => socket.send(JSON.stringify({ t: "sub", r: roomId })));
        socket.on("error", reject);
      }),
    20000
  );
}
