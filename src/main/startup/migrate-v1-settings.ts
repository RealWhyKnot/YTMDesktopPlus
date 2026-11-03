import { isRecord } from "~shared/unknown";
import { app, dialog } from "electron";

import path from "path";

import fs from "fs/promises";

import type { MainContext } from "../index";

export async function migrateV1Settings(context: MainContext): Promise<void> {
  const firstRunPath = path.join(app.getPath("userData"), ".first-run");
  let isFirstRun = false;
  try {
    await fs.access(firstRunPath, fs.constants.F_OK);
  } catch {
    isFirstRun = true;
  }
  if (isFirstRun) {
    const firstRunTouch = await fs.open(firstRunPath, "a");
    await firstRunTouch.close();

    const v1ConfigPath = path.join(app.getPath("userData"), "..", "youtube-music-desktop-app", "config.json");
    try {
      const v1Config: unknown = JSON.parse(await fs.readFile(v1ConfigPath, { encoding: "utf-8" }));
      if (!isRecord(v1Config)) throw new Error("Invalid v1 settings file");
      const migrateDialog = await dialog.showMessageBox({
        type: "question",
        message: "Would you like to migrate your settings?",
        detail:
          "A configuration file for YouTube Music Desktop App v1 was found. Your settings can be migrated.\n\nWARNING: Not all settings will be migrated as they may no longer be available in this version.",
        buttons: ["No", "Migrate Settings"],
      });

      if (migrateDialog.response === 1) {
        if (typeof v1Config["settings-companion-server"] === "boolean") {
          context.store.set("integrations.companionServerEnabled", v1Config["settings-companion-server"]);
          context.store.set("integrations.companionServerLANEnabled", v1Config["settings-companion-server"]);
        }

        if (typeof v1Config["settings-continue-where-left-of"] === "boolean") {
          context.store.set("playback.continueWhereYouLeftOff", v1Config["settings-continue-where-left-of"]);
        }

        if (typeof v1Config["settings-custom-css-page"] === "boolean") {
          if (v1Config["settings-custom-css-page"]) {
            const v1CustomCSSPath = path.join(app.getPath("userData"), "..", "youtube-music-desktop-app", "custom", "css", "page.css");
            const copyPath = path.join(app.getPath("userData"), "custom_css.css");
            await fs.copyFile(v1CustomCSSPath, copyPath);

            context.store.set("appearance.customCSSPath", copyPath);
            context.store.set("appearance.customCSSEnabled", true);
          }
        }

        if (typeof v1Config["settings-decibel-volume"] === "boolean") {
          context.store.set("playback.ratioVolume", v1Config["settings-decibel-volume"]);
        }

        if (typeof v1Config["settings-discord-rich-presence"] === "boolean") {
          context.store.set("integrations.discordPresenceEnabled", v1Config["settings-discord-rich-presence"]);
        }

        if (typeof v1Config["settings-page-zoom"] === "number") {
          context.store.set("appearance.zoom", v1Config["settings-page-zoom"]);
        }

        if (typeof v1Config["settings-keep-background"] === "boolean") {
          context.store.set("general.hideToTrayOnClose", v1Config["settings-keep-background"]);
        }

        if (typeof v1Config["settings-show-notifications"] === "boolean") {
          context.store.set("general.showNotificationOnSongChange", v1Config["settings-show-notifications"]);
        }

        if (typeof v1Config["settings-start-minimized"] === "boolean") {
          context.store.set("general.startMinimized", v1Config["settings-start-minimized"]);
        }

        if (typeof v1Config["settings-start-on-boot"] === "boolean") {
          context.store.set("general.startOnBoot", v1Config["settings-start-on-boot"]);
        }

        if (typeof v1Config["settings-surround-sound"] === "boolean") {
          context.store.set("playback.enableSpeakerFill", v1Config["settings-surround-sound"]);
        }

        if (isRecord(v1Config["settings-accelerators"])) {
          if (typeof v1Config["settings-accelerators"]["media-play-pause"] === "string") {
            if (v1Config["settings-accelerators"]["media-play-pause"].toLowerCase() !== "disabled") {
              context.store.set("shortcuts.playPause", v1Config["settings-accelerators"]["media-play-pause"]);
            }
          }

          if (typeof v1Config["settings-accelerators"]["media-track-next"] === "string") {
            if (v1Config["settings-accelerators"]["media-track-next"].toLowerCase() !== "disabled") {
              context.store.set("shortcuts.next", v1Config["settings-accelerators"]["media-track-next"]);
            }
          }

          if (typeof v1Config["settings-accelerators"]["media-track-previous"] === "string") {
            if (v1Config["settings-accelerators"]["media-track-previous"].toLowerCase() !== "disabled") {
              context.store.set("shortcuts.previous", v1Config["settings-accelerators"]["media-track-previous"]);
            }
          }

          if (typeof v1Config["settings-accelerators"]["media-track-like"] === "string") {
            if (v1Config["settings-accelerators"]["media-track-like"].toLowerCase() !== "disabled") {
              context.store.set("shortcuts.thumbsUp", v1Config["settings-accelerators"]["media-track-like"]);
            }
          }

          if (typeof v1Config["settings-accelerators"]["media-track-dislike"] === "string") {
            if (v1Config["settings-accelerators"]["media-track-dislike"].toLowerCase() !== "disabled") {
              context.store.set("shortcuts.thumbsDown", v1Config["settings-accelerators"]["media-track-dislike"]);
            }
          }

          if (typeof v1Config["settings-accelerators"]["media-volume-up"] === "string") {
            if (v1Config["settings-accelerators"]["media-volume-up"].toLowerCase() !== "disabled") {
              context.store.set("shortcuts.volumeUp", v1Config["settings-accelerators"]["media-volume-up"]);
            }
          }

          if (typeof v1Config["settings-accelerators"]["media-volume-down"] === "string") {
            if (v1Config["settings-accelerators"]["media-volume-down"].toLowerCase() !== "disabled") {
              context.store.set("shortcuts.volumeDown", v1Config["settings-accelerators"]["media-volume-down"]);
            }
          }
        }

        if (isRecord(v1Config["last-fm-login"])) {
          const isUsernameEmpty = typeof v1Config["last-fm-login"].username !== "string" || v1Config["last-fm-login"].username.trim() === "";
          const isPasswordEmpty = typeof v1Config["last-fm-login"].password !== "string" || v1Config["last-fm-login"].password.trim() === "";
          if (!isUsernameEmpty && !isPasswordEmpty) {
            context.store.set("integrations.lastFMEnabled", true);

            await dialog.showMessageBox({
              type: "info",
              message: "Last.fm",
              detail: "Last.fm configuration was found and has NOT been migrated. Re-authentication is required.",
            });
          }
        }

        await dialog.showMessageBox({
          type: "info",
          message: "Settings migrated.",
          detail: "Your settings have been migrated.",
        });
      }
    } catch (error) {
      console.warn("migrate-v1-settings: operation failed", error);
    }
  }
}
