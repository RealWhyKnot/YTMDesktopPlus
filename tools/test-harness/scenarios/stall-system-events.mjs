import { execFileSync } from "node:child_process";

export const inspectMain = true;

const BLOCK_MS = 600;
const WM_DISPLAYCHANGE = 0x007e;
const WM_DEVICECHANGE = 0x0219;
const DBT_DEVNODES_CHANGED = 0x0007;
const DBT_DEVICEARRIVAL = 0x8000;

function postMessages(hwnd, messages) {
  const posts = messages.map(([message, wParam]) => `[void][Ytmd.User32]::PostMessage([IntPtr]${hwnd}, ${message}, [IntPtr]${wParam}, [IntPtr]0)`).join("; ");
  const signature = `[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);`;
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Add-Type -Namespace Ytmd -Name User32 -MemberDefinition '${signature}'; ${posts}`
  ]);
}

export default async function stallSystemEvents(ctx) {
  if (process.platform !== "win32") ctx.environmentBlocked("window message hooks are Windows only");

  let hwnd = null;
  await ctx.step(
    "main window handle",
    async () => {
      hwnd = await ctx.evalMainProcess(`(() => {
        const { BrowserWindow } = process.mainModule.require("electron");
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("windows/main/index.html"));
        return win ? win.getNativeWindowHandle().readBigUInt64LE(0).toString() : null;
      })()`);
      if (!hwnd) throw new Error("main window not found");
    },
    15000
  );

  await ctx.step(
    "a stall names the display, device and power events before it",
    async () => {
      postMessages(hwnd, [
        [WM_DISPLAYCHANGE, 32],
        [WM_DEVICECHANGE, DBT_DEVICEARRIVAL],
        [WM_DEVICECHANGE, DBT_DEVNODES_CHANGED]
      ]);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await ctx.evalMainProcess(`(() => {
        const { powerMonitor, screen } = process.mainModule.require("electron");
        powerMonitor.emit("resume");
        screen.emit("display-removed", {}, {});
        const end = Date.now() + ${BLOCK_MS};
        while (Date.now() < end);
        return true;
      })()`);
      await ctx.waitMainLog(/Main thread blocked for \d+ms \(no labelled work; system: display change, device change, resume, display removed\)/, 10000);
      await ctx.waitMainLog(/System event: display removed/, 1000);
    },
    30000
  );
}
