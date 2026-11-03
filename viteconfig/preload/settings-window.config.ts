import { defineConfig } from "vite";
import { preloadConfig } from "../lib";

export default defineConfig(preloadConfig("settings"));
