import path from "node:path";
import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "~shared": path.resolve(__dirname, "../../src/shared")
    }
  },
  build: {
    outDir: ".vite/renderer/windows/ytmview"
  },
  define: {
    // Developer diagnostics that ship in development and local sideload builds
    // but are compiled out of published beta and release builds. Kept in step
    // with the same flag in viteconfig/main.ts.
    YTMD_DEV_TOOLS: process.env.NODE_ENV === "development" || process.env.YTMD_LOCAL_BUILD === "1"
  }
});
