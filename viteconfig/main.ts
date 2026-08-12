import { defineConfig } from "vite";
import { gitInfo, sharedAlias } from "./lib";

const { branch: gitBranch } = gitInfo();

// HEAD is used for production builds as they check out version tags in a detached HEAD state
const devBuild = gitBranch !== "HEAD" && process.env.NODE_ENV === "development";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: sharedAlias
  },
  build: {
    outDir: ".vite/main",
    rollupOptions: {
      external: ["bufferutil", "utf-8-validate"]
    }
  },
  define: {
    YTMD_DISABLE_UPDATES: devBuild,
    // Set by scripts/Install-Local.ps1 so a sideloaded build never checks for
    // updates it is already ahead of.
    YTMD_LOCAL_BUILD: process.env.YTMD_LOCAL_BUILD === "1",
    // Developer diagnostics that ship in development and local sideload builds
    // but are compiled out of published beta and release builds.
    YTMD_DEV_TOOLS: devBuild || process.env.YTMD_LOCAL_BUILD === "1"
  }
});
