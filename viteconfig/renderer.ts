import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { gitInfo, sharedAlias } from "./lib";

const { branch: gitBranch, commitHash: gitCommitHash } = gitInfo();

// https://vitejs.dev/config
export default defineConfig({
  root: "src/renderer",
  build: {
    outDir: "../../.vite/renderer",
    rollupOptions: {
      input: {
        main_window: "src/renderer/windows/main/index.html",
        settings_window: "src/renderer/windows/settings/index.html",
        authorize_companion_window: "src/renderer/windows/authorize-companion/index.html",
        room_window: "src/renderer/windows/room/index.html",
        dj_analysis_window: "src/renderer/windows/dj-analysis/index.html"
      },
      output: {
        manualChunks: {
          vue: ["vue"]
        }
      }
    }
  },
  plugins: [
    vue({
      features: {
        optionsAPI: false
      }
    })
  ],
  resolve: {
    alias: {
      ...sharedAlias,
      "~assets": path.resolve(__dirname, "../src/assets")
    }
  },
  define: {
    YTMD_GIT_COMMIT_HASH: JSON.stringify(gitCommitHash),
    YTMD_GIT_BRANCH: JSON.stringify(gitBranch)
  }
});
