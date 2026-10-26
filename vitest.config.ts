import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "~assets": fileURLToPath(new URL("./src/assets", import.meta.url))
    }
  },
  test: {
    setupFiles: ["tests/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/components/**"],
          environment: "node"
        }
      },
      {
        extends: true,
        plugins: [vue()],
        test: {
          name: "components",
          include: ["tests/components/**/*.test.ts"],
          environment: "happy-dom"
        }
      }
    ]
  }
});
