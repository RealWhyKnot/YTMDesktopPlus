import type { WebContents } from "electron";
import type { ThemeCss, ThemeDescriptor } from "~shared/themes/sdk";
import type { IpcRegistrar } from "./registrar";

export interface ThemeIpcDeps {
  descriptors(): ThemeDescriptor[];
  getCss(): ThemeCss;
  setActive(id: string | null): { ok: true } | { ok: false; reason: string };
  duplicate(id: string): { ok: true; id: string; dir: string } | { ok: false; reason: string };
  exportTo(id: string, destination: string): { ok: true } | { ok: false; reason: string };
  install(zipPath: string): { ok: true; id: string } | { ok: false; reason: string };
  openThemesFolder(): void;
  revealPath(target: string): void;
  pickArchive(): Promise<string | null>;
  pickExportDestination(suggestedName: string): Promise<string | null>;
  isSettingsSender(sender: WebContents): boolean;
}

export function registerThemeIpc(ipc: IpcRegistrar, deps: ThemeIpcDeps): void {
  ipc.handle("themes:getAll", event => {
    if (!deps.isSettingsSender(event.sender)) return [];
    return deps.descriptors();
  });

  ipc.handle("themes:setActive", (event, ...args) => {
    if (!deps.isSettingsSender(event.sender)) return { ok: false, reason: "not allowed" };
    const id = args[0];
    if (id === null) return deps.setActive(null);
    if (typeof id === "string") return deps.setActive(id);
    return { ok: false, reason: "not allowed" };
  });

  ipc.handle("themes:duplicate", async (event, ...args) => {
    if (!deps.isSettingsSender(event.sender)) return { ok: false, reason: "not allowed" };
    if (typeof args[0] !== "string") return { ok: false, reason: "not allowed" };
    const result = deps.duplicate(args[0]);
    if (result.ok) deps.revealPath(result.dir);
    return result;
  });

  ipc.handle("themes:export", async (event, ...args) => {
    if (!deps.isSettingsSender(event.sender)) return { ok: false, reason: "not allowed" };
    if (typeof args[0] !== "string") return { ok: false, reason: "not allowed" };
    const destination = await deps.pickExportDestination(`${args[0]}.zip`);
    if (destination === null) return { ok: false, reason: "cancelled" };
    return deps.exportTo(args[0], destination);
  });

  ipc.handle("themes:installFromFile", async event => {
    if (!deps.isSettingsSender(event.sender)) return { ok: false, reason: "not allowed" };
    const archive = await deps.pickArchive();
    if (archive === null) return { ok: false, reason: "cancelled" };
    return deps.install(archive);
  });

  ipc.on("themes:openFolder", event => {
    if (!deps.isSettingsSender(event.sender)) return;
    deps.openThemesFolder();
  });

  ipc.on("themes:getActiveCss", event => {
    event.returnValue = deps.getCss();
  });
}
