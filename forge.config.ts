import { cpSync, existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import type { ForgeConfig } from "@electron-forge/shared-types";

const appVersion: string = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")).version;
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

// There is probably a better way to do this, such as fetching it directly from forge
let makerArch = null;
for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--arch") {
    makerArch = process.argv[i + 1];
  }
}

// Vite bundles the main process, so a packaged build ships no node_modules. The
// ad blocker is the exception: it reaches its content-script preload through
// require.resolve, which runs while the main bundle is still loading, so a miss
// stops the app from starting rather than merely disabling ad blocking.
const ADBLOCKER_PRELOAD_PACKAGE = path.join("node_modules", "@ghostery", "adblocker-electron-preload");

const config: ForgeConfig = {
  hooks: {
    // After the prune step, which walks the copied node_modules and would take
    // this straight back out again.
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      const destination = path.join(buildPath, ADBLOCKER_PRELOAD_PACKAGE);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.resolve(__dirname, ADBLOCKER_PRELOAD_PACKAGE), destination, { recursive: true });

      const entryPoint = path.join(destination, "dist", "index.cjs");
      if (!existsSync(entryPoint)) {
        throw new Error(`Ad blocker preload missing from the package at ${entryPoint}`);
      }
    }
  },
  packagerConfig: {
    // Must match the package name: the deb and rpm makers look the binary up
    // by that name.
    executableName: "ytmdesktop-plus",
    icon: "./src/assets/icons/ytmd",
    extraResource: [
      "./src/assets/icons/tray.ico",
      "./src/assets/icons/trayTemplate.png",
      "./src/assets/icons/trayTemplate@2x.png",
      "./src/assets/icons/ytmd.png",
      "./src/assets/icons/ytmd_white.png",
      "./src/assets/icons/ytmd_black.png",

      "./src/assets/icons/controls/pause-button.png",
      "./src/assets/icons/controls/play-button.png",
      "./src/assets/icons/controls/play-next-button.png",
      "./src/assets/icons/controls/play-previous-button.png"
    ],
    protocols: [
      {
        name: "YTMDesktopPlus",
        schemes: ["ytmdplus"]
      }
    ],
    appCategoryType: "public.app-category.music",
    asar: true
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      iconUrl: "https://raw.githubusercontent.com/RealWhyKnot/YTMDesktopPlus/main/src/assets/icons/ytmd.ico"
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({
      options: {
        categories: ["AudioVideo", "Audio"],
        mimeType: ["x-scheme-handler/ytmdplus"],
        icon: "./src/assets/icons/ytmd.png"
      }
    }),
    new MakerDeb({
      options: {
        categories: ["AudioVideo", "Audio"],
        mimeType: ["x-scheme-handler/ytmdplus"],
        section: "sound",
        icon: "./src/assets/icons/ytmd.png"
      }
    })
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: process.env.YTMD_UPDATE_FEED_OWNER ?? "RealWhyKnot",
          name: process.env.YTMD_UPDATE_FEED_REPOSITORY ?? "YTMDesktopPlus"
        },
        // Releases go out published, not as drafts. Betas are flagged as
        // prereleases so the update feed keeps serving the latest stable.
        draft: false,
        prerelease: appVersion.includes("-beta")
      }
    }
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "viteconfig/main.ts",
          target: "main"
        },
        // TODO: Utilize a single config for preload so we can share chunks if needed
        {
          entry: "src/renderer/windows/main/preload.ts",
          config: "viteconfig/preload/main_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/settings/preload.ts",
          config: "viteconfig/preload/settings_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/authorize-companion/preload.ts",
          config: "viteconfig/preload/authorize_companion_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/room/preload.ts",
          config: "viteconfig/preload/room_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/dj-analysis/preload.ts",
          config: "viteconfig/preload/dj_analysis_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/windows/addon/preload.ts",
          config: "viteconfig/preload/addon_window.ts",
          target: "preload"
        },
        {
          entry: "src/renderer/ytmview/preload.ts",
          config: "viteconfig/preload/ytmview.ts",
          target: "preload"
        }
      ],
      renderer: [
        // Instead of opting for defining each window as a separate object we bundle them all together and have a more custom output to share chunks
        {
          name: "all_windows",
          config: "viteconfig/renderer.ts"
        }
      ]
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: process.platform === "darwin" && makerArch == "arm64",
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
