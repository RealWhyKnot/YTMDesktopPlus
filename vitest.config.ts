import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { pageScripts } from "./viteconfig/page-scripts.mts";

export default defineConfig({
  plugins: [pageScripts()],
  resolve: {
    alias: {
      "~shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "~assets": fileURLToPath(new URL("./src/assets", import.meta.url)),
    },
  },
  test: {
    setupFiles: ["tests/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/components/**", "tests/integration-*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration-*.test.ts"],
          environment: "node",
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        plugins: [vue()],
        test: {
          name: "components",
          include: ["tests/components/**/*.test.ts"],
          environment: "happy-dom",
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
