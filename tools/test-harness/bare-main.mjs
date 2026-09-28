import { app, BrowserWindow } from "electron";

const profile = process.env.YTMD_BARE_PROFILE;
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.commandLine.appendSwitch("mute-audio");
app.commandLine.appendSwitch("remote-debugging-port", process.env.YTMD_BARE_CDP_PORT);

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1280,
    height: 760,
    webPreferences: {
      partition: "persist:ytmview-dev",
      sandbox: true,
      contextIsolation: true,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false
    }
  });
  window.webContents.setAudioMuted(true);
  window.webContents.on("did-finish-load", () => window.webContents.setAudioMuted(true));
  window.loadURL("https://music.youtube.com/");
});

app.on("window-all-closed", () => app.quit());
