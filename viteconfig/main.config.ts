import { defineConfig } from "vite";
import { gitInfo, sharedAlias } from "./lib";
import { pageScripts } from "./page-scripts.mts";

const { branch: gitBranch } = gitInfo();

const isDevBuild = gitBranch !== "HEAD" && process.env.NODE_ENV === "development";

export default defineConfig({
  plugins: [pageScripts()],
  resolve: {
    alias: sharedAlias,
  },
  build: {
    outDir: ".vite/main",
    rollupOptions: {
      external: ["bufferutil", "utf-8-validate"],
    },
  },
  define: {
    isYtmdDisableUpdates: isDevBuild,

    isYtmdLocalBuild: process.env.YTMD_LOCAL_BUILD === "1",

    isYtmdDevTools: isDevBuild || process.env.YTMD_LOCAL_BUILD === "1",
  },
});
