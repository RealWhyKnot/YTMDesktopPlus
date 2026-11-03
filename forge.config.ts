import { existsSync, readFileSync } from "fs";
import { cp, mkdir, rename } from "fs/promises";
import path from "path";
import type { ForgeConfig } from "@electron-forge/shared-types";

import { isRecord } from "./src/shared/unknown";

function packageVersion(value: unknown): string {
  if (!isRecord(value) || typeof value.version !== "string") throw new TypeError("The package version is missing");
  return value.version;
}

const appVersion = packageVersion(JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")));
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerFlatpak, flatpakArch } from "@electron-forge/maker-flatpak";
import MakerAppImage from "@reforged/maker-appimage";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

let makerArch = null;
for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--arch") {
    makerArch = process.argv[i + 1];
  }
}

const ADBLOCKER_PRELOAD_PACKAGE = path.join("node_modules", "@ghostery", "adblocker-electron-preload");

const optionalEnv = (value: string | undefined) => (value === "" ? undefined : value);

const windowsSign =
  process.env.WINDOWS_CERTIFICATE_FILE || process.env.WINDOWS_SIGN_WITH_PARAMS
    ? {
        certificateFile: optionalEnv(process.env.WINDOWS_CERTIFICATE_FILE),
        certificatePassword: optionalEnv(process.env.WINDOWS_CERTIFICATE_PASSWORD),
        signWithParams: optionalEnv(process.env.WINDOWS_SIGN_WITH_PARAMS),
        signToolPath: optionalEnv(process.env.WINDOWS_SIGNTOOL_PATH),
      }
    : undefined;

const config: ForgeConfig = {
  hooks: {
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      const destination = path.join(buildPath, ADBLOCKER_PRELOAD_PACKAGE);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.resolve(__dirname, ADBLOCKER_PRELOAD_PACKAGE), destination, { recursive: true });

      const entryPoint = path.join(destination, "dist", "index.cjs");
      if (!existsSync(entryPoint)) {
        throw new Error(`Ad blocker preload missing from the package at ${entryPoint}`);
      }
    },

    postMake: async (_forgeConfig, makeResults) => {
      for (const result of makeResults) {
        const artifacts: string[] = [];
        for (const artifact of result.artifacts) {
          const extension = path.extname(artifact);
          if (extension !== ".flatpak" && extension !== ".AppImage") {
            artifacts.push(artifact);
            continue;
          }

          const renamed = path.join(path.dirname(artifact), `YTMDesktopPlus-${packageVersion(result.packageJSON)}-${flatpakArch(result.arch)}${extension}`);
          await rename(artifact, renamed);
          artifacts.push(renamed);
        }
        result.artifacts = artifacts;
      }
      return makeResults;
    },
  },
  packagerConfig: {
    executableName: "ytmdesktop-plus",
    icon: "./src/assets/icons/ytmd",
    extraResource: [
      "./src/themes",

      "./src/assets/icons/tray.ico",
      "./src/assets/icons/trayTemplate.png",
      "./src/assets/icons/trayTemplate@2x.png",
      "./src/assets/icons/ytmd.png",
      "./src/assets/icons/ytmd_white.png",
      "./src/assets/icons/ytmd_black.png",

      "./src/assets/icons/controls/pause-button.png",
      "./src/assets/icons/controls/play-button.png",
      "./src/assets/icons/controls/play-next-button.png",
      "./src/assets/icons/controls/play-previous-button.png",
    ],
    protocols: [
      {
        name: "YTMDesktopPlus",
        schemes: ["ytmdplus"],
      },
    ],
    appCategoryType: "public.app-category.music",
    asar: true,
    ...(windowsSign ? { windowsSign } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      iconUrl: "https://raw.githubusercontent.com/RealWhyKnot/YTMDesktopPlus/main/src/assets/icons/ytmd.ico",
      ...(windowsSign ? { windowsSign } : {}),
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({
      options: {
        categories: ["AudioVideo", "Audio"],
        mimeType: ["x-scheme-handler/ytmdplus"],
        requires: ["(alsa-lib or libasound2)"],
        icon: "./src/assets/icons/ytmd.png",
      },
    }),
    new MakerDeb({
      options: {
        categories: ["AudioVideo", "Audio"],
        mimeType: ["x-scheme-handler/ytmdplus"],
        section: "sound",
        depends: ["libasound2t64 | libasound2"],
        icon: "./src/assets/icons/ytmd.png",
      },
    }),
    new MakerAppImage({
      options: {
        categories: ["AudioVideo", "Audio"],
        mimeType: ["x-scheme-handler/ytmdplus"],
        icon: "./src/assets/icons/ytmd.png",
      },
    }),

    ...(makerArch !== "arm64"
      ? [
          new MakerFlatpak({
            options: {
              id: "dev.whyknot.YTMDesktopPlus",
              base: "org.electronjs.Electron2.BaseApp",
              baseVersion: "25.08",
              runtime: "org.freedesktop.Platform",
              runtimeVersion: "25.08",
              sdk: "org.freedesktop.Sdk",
              categories: ["AudioVideo", "Audio"],
              mimeType: ["x-scheme-handler/ytmdplus"],
              icon: "./src/assets/icons/ytmd.png",

              files: [
                ["./src/assets/icons/ytmd.png", "/share/icons/hicolor/512x512/apps/dev.whyknot.YTMDesktopPlus.png"],
                ["./flatpak/dev.whyknot.YTMDesktopPlus.metainfo.xml", "/share/metainfo/dev.whyknot.YTMDesktopPlus.metainfo.xml"],
              ],
              modules: [],
              finishArgs: [
                "--share=ipc",
                "--share=network",
                "--socket=x11",
                "--socket=wayland",
                "--socket=pulseaudio",
                "--device=dri",

                "--env=TMPDIR=/var/tmp",
                "--talk-name=org.kde.StatusNotifierWatcher",
                "--talk-name=org.freedesktop.Notifications",
                "--own-name=org.mpris.MediaPlayer2.chromium.*",
                "--talk-name=org.freedesktop.secrets",
                "--talk-name=org.kde.kwalletd5",
                "--talk-name=org.kde.kwalletd6",
                ...Array.from({ length: 10 }, (_, id) => `--filesystem=xdg-run/discord-ipc-${id}`),
                "--filesystem=xdg-run/app/com.discordapp.Discord:create",
              ],
            },
          }),
        ]
      : []),
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: process.env.YTMD_UPDATE_FEED_OWNER ?? "RealWhyKnot",
          name: process.env.YTMD_UPDATE_FEED_REPOSITORY ?? "YTMDesktopPlus",
        },

        draft: false,
        prerelease: appVersion.includes("-beta"),
      },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "viteconfig/main.config.ts",
          target: "main",
        },
        {
          entry: "src/main/services/audio-uplink.ts",
          config: "viteconfig/main.config.ts",
          target: "main",
        },

        {
          entry: "src/renderer/windows/main/preload.ts",
          config: "viteconfig/preload/main-window.config.ts",
          target: "preload",
        },
        {
          entry: "src/renderer/windows/settings/preload.ts",
          config: "viteconfig/preload/settings-window.config.ts",
          target: "preload",
        },
        {
          entry: "src/renderer/windows/authorize-companion/preload.ts",
          config: "viteconfig/preload/authorize-companion-window.config.ts",
          target: "preload",
        },
        {
          entry: "src/renderer/windows/room/preload.ts",
          config: "viteconfig/preload/room-window.config.ts",
          target: "preload",
        },
        {
          entry: "src/renderer/windows/addon/preload.ts",
          config: "viteconfig/preload/addon-window.config.ts",
          target: "preload",
        },
        {
          entry: "src/renderer/windows/media-host/preload.ts",
          config: "viteconfig/preload/media-host-window.config.ts",
          target: "preload",
        },
        {
          entry: "src/renderer/ytmview/preload.ts",
          config: "viteconfig/preload/ytmview.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "all_windows",
          config: "viteconfig/renderer.config.ts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: process.platform === "darwin" && makerArch === "arm64",
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
