type LaunchWindow = {
  show(): void;
  maximize(): void;
  on(event: "ready-to-show", listener: () => void): unknown;
  once(event: "show", listener: () => void): unknown;
};

export function startsHidden(general: { startMinimized?: boolean }, platform: NodeJS.Platform): boolean {
  return general.startMinimized === true && platform !== "darwin";
}

export function applyLaunchVisibility(window: LaunchWindow, options: { hidden: boolean; maximized: boolean }) {
  if (options.maximized) {
    if (options.hidden) window.once("show", () => window.maximize());
    else window.maximize();
  }
  if (!options.hidden) window.on("ready-to-show", () => window.show());
}
