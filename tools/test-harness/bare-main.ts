import { stringValue } from "./values.ts";
import { app, BrowserWindow, session } from "electron";

const profile = process.env.YTMD_BARE_PROFILE;
app.setPath("userData", stringValue(profile));
app.setPath("sessionData", stringValue(profile));
app.commandLine.appendSwitch("mute-audio");
app.commandLine.appendSwitch("remote-debugging-port", process.env.YTMD_BARE_CDP_PORT);

void app
  .whenReady()
  .then(() => {
    session
      .fromPartition("persist:ytmview-dev")
      .webRequest.onBeforeSendHeaders({ urls: ["*://*.youtube.com/api/stats/playback*", "*://*.youtube.com/api/stats/watchtime*"] }, (_details, callback) =>
        callback({ cancel: true })
      );
    const window = new BrowserWindow({
      width: 1280,
      height: 760,
      webPreferences: {
        partition: "persist:ytmview-dev",
        sandbox: true,
        contextIsolation: true,
        autoplayPolicy: "no-user-gesture-required",
        backgroundThrottling: false,
      },
    });
    window.webContents.setAudioMuted(true);
    window.webContents.on("did-finish-load", () => window.webContents.setAudioMuted(true));
    void window.loadURL("https://music.youtube.com/").catch((error: unknown) => console.warn("bare-main: page load failed", error));
  })
  .catch((error: unknown) => console.warn("bare-main: operation failed", error));

app.on("window-all-closed", () => app.quit());
