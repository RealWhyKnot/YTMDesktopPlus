import { defineConfig } from "vite";
import { preloadConfig } from "../lib";

export default defineConfig(
  preloadConfig("ytmview", {
    define: {
      isYtmdDevTools: process.env.NODE_ENV === "development" || process.env.YTMD_LOCAL_BUILD === "1",
    },
  })
);
