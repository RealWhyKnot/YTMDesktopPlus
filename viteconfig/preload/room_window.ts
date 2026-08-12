import { defineConfig } from "vite";
import { preloadConfig } from "../lib";

// https://vitejs.dev/config
export default defineConfig(preloadConfig("room"));
